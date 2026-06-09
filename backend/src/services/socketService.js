import { Server } from 'socket.io';
import crypto from 'crypto';
import redis from '../config/redis.js';

// Local map of active socket connections in this process instance
const activeSockets = new Map();

export const initSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    activeSockets.set(socket.id, socket);

    // 1. Sender registers a P2P session
    socket.on('register-p2p', async ({ files }) => {
      try {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 characters (excluding confusing O, 0, I, 1)
        let pin = '';
        
        // Loop to find a unique PIN
        for (let attempt = 0; attempt < 15; attempt++) {
          let tempPin = '';
          for (let i = 0; i < 5; i++) {
            const randomIndex = crypto.randomInt(0, chars.length);
            tempPin += chars[randomIndex];
          }
          
          // Ensure it does not exist in Redis (both regular uploads and p2p sessions)
          const dbExists = await redis.get(`pin:${tempPin}`);
          const p2pExists = await redis.get(`p2p:pin:${tempPin}`);
          if (!dbExists && !p2pExists) {
            pin = tempPin;
            break;
          }
        }

        if (!pin) {
          socket.emit('p2p-error', { message: 'Failed to generate a unique PIN' });
          return;
        }

        const expiryMinutes = 2; // P2P sessions can stay active for up to 2 minutes, or until sender disconnects
        const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

        const session = {
          pin,
          senderSocketId: socket.id,
          files, // Array of { name, size, type }
          expiresAt: expiresAt.toISOString()
        };

        // Cache the P2P session in Redis (expires in 2 minutes)
        await redis.set(`p2p:pin:${pin}`, JSON.stringify(session), 'EX', expiryMinutes * 60);
        
        socket.p2pPin = pin;
        socket.p2pRole = 'sender';

        socket.emit('p2p-registered', { pin, expiresAt: expiresAt.toISOString() });
        console.log(`P2P Registered PIN: ${pin} for Sender Socket: ${socket.id}`);
      } catch (err) {
        console.error('Error in register-p2p:', err);
        socket.emit('p2p-error', { message: 'Server error registering P2P session.' });
      }
    });

    // 2. Receiver joins P2P session by PIN
    socket.on('join-p2p-receiver', async ({ pin, receiverClientId }) => {
      try {
        if (!receiverClientId) {
          socket.emit('p2p-error', { message: 'Receiver client identifier required.' });
          return;
        }

        // First, check if there is an active session for this receiver client
        const existingSessionData = await redis.get(`p2p:session:${receiverClientId}`);
        if (existingSessionData) {
          // Reconnection flow
          const session = JSON.parse(existingSessionData);
          const senderSocket = activeSockets.get(session.senderSocketId);

          if (!senderSocket) {
            socket.emit('p2p-error', { message: 'Sender is offline. Please keep the sender page open.' });
            return;
          }

          socket.p2pPin = session.pin;
          socket.p2pRole = 'receiver';
          socket.p2pSenderSocketId = session.senderSocketId;
          senderSocket.p2pReceiverSocketId = socket.id;
          senderSocket.p2pReceiverClientId = receiverClientId;

          session.receiverSocketId = socket.id;
          // Refresh session TTL to 1 hour
          await redis.set(`p2p:session:${receiverClientId}`, JSON.stringify(session), 'EX', 3600);

          // Notify sender of receiver's reconnection
          senderSocket.emit('receiver-reconnected', { receiverSocketId: socket.id });

          // Notify receiver that they successfully rejoined
          socket.emit('p2p-joined', { files: session.files, senderSocketId: session.senderSocketId, isReconnect: true });
          console.log(`P2P Receiver: ${socket.id} reconnected using client ID: ${receiverClientId}. Notified Sender: ${session.senderSocketId}`);
          return;
        }

        // If no active session by client ID, check the PIN for first-time join
        if (!pin || pin.length !== 5) {
          socket.emit('p2p-error', { message: 'Invalid PIN format.' });
          return;
        }

        const sessionData = await redis.get(`p2p:pin:${pin}`);
        if (!sessionData) {
          socket.emit('p2p-error', { message: 'PIN not found or has expired.' });
          return;
        }

        const session = JSON.parse(sessionData);
        const senderSocket = activeSockets.get(session.senderSocketId);

        if (!senderSocket) {
          socket.emit('p2p-error', { message: 'Sender is offline. Please keep the sender page open.' });
          return;
        }

        // First-time join flow: Link socket details
        socket.p2pPin = pin;
        socket.p2pRole = 'receiver';
        socket.p2pSenderSocketId = session.senderSocketId;
        
        senderSocket.p2pReceiverSocketId = socket.id;
        senderSocket.p2pReceiverClientId = receiverClientId;

        // Register the receiver details in the session
        session.receiverClientId = receiverClientId;
        session.receiverSocketId = socket.id;

        // Delete the PIN from Redis so it is used once and cannot be used again
        await redis.del(`p2p:pin:${pin}`);

        // Save session under the receiver client ID key for future reconnections (expires in 1 hour)
        await redis.set(`p2p:session:${receiverClientId}`, JSON.stringify(session), 'EX', 3600);

        // Notify the sender that a receiver is ready to connect, providing the receiver's socket ID
        senderSocket.emit('receiver-joined', { receiverSocketId: socket.id });
        
        // Notify the receiver that they successfully joined the room
        socket.emit('p2p-joined', { files: session.files, senderSocketId: session.senderSocketId, isReconnect: false });
        console.log(`P2P Receiver: ${socket.id} joined PIN: ${pin}. Notified Sender: ${session.senderSocketId}, deleted PIN, and registered session.`);
      } catch (err) {
        console.error('Error in join-p2p-receiver:', err);
        socket.emit('p2p-error', { message: 'Server error joining P2P session.' });
      }
    });

    // 3. Signaling: Relay WebRTC Offers / Answers
    socket.on('p2p-signal', ({ targetSocketId, signal }) => {
      const targetSocket = activeSockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('p2p-signal', { senderSocketId: socket.id, signal });
      }
    });

    // 4. Signaling: Relay ICE Candidates
    socket.on('p2p-ice-candidate', ({ targetSocketId, candidate }) => {
      const targetSocket = activeSockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('p2p-ice-candidate', { senderSocketId: socket.id, candidate });
      }
    });

    // 5. Cleanup on disconnection
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id}`);
      activeSockets.delete(socket.id);

      if (socket.p2pPin) {
        const pin = socket.p2pPin;
        const role = socket.p2pRole;

        try {
          if (role === 'sender') {
            // Delete Redis entry (in case no receiver joined yet)
            await redis.del(`p2p:pin:${pin}`);
            if (socket.p2pReceiverClientId) {
              await redis.del(`p2p:session:${socket.p2pReceiverClientId}`);
            }
            
            // Notify linked receiver of sender drop
            if (socket.p2pReceiverSocketId) {
              const receiverSocket = activeSockets.get(socket.p2pReceiverSocketId);
              if (receiverSocket) {
                receiverSocket.emit('p2p-session-closed', { message: 'Sender disconnected. Transfer aborted.' });
              }
            }
            console.log(`P2P Session for PIN ${pin} closed because sender socket ${socket.id} disconnected.`);
          } else if (role === 'receiver') {
            // Notify linked sender of receiver drop
            if (socket.p2pSenderSocketId) {
              const senderSocket = activeSockets.get(socket.p2pSenderSocketId);
              if (senderSocket) {
                senderSocket.emit('receiver-disconnected', { message: 'Receiver disconnected.' });
                delete senderSocket.p2pReceiverSocketId;
              }
            }
            console.log(`P2P Receiver ${socket.id} disconnected for PIN ${pin}. Notified Sender.`);
          }
        } catch (err) {
          console.error('Error handling P2P disconnect cleanup:', err);
        }
      }
    });
  });

  return io;
};
