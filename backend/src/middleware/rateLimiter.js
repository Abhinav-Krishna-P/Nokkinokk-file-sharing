import redis from '../config/redis.js';

export const pinRateLimiter = async (req, res, next) => {
  const ip = req.ip;
  const redisKey = `ratelimit:pin:${ip}`;
  
  try {
    const attempts = await redis.get(redisKey);
    const attemptCount = attempts ? parseInt(attempts, 10) : 0;
    
    if (attemptCount >= 5) {
      return res.status(429).json({
        success: false,
        message: 'Too many retrieval attempts. Please try again after a minute.',
      });
    }
    
    // Increment attempt count
    const multi = redis.multi();
    multi.incr(redisKey);
    
    // Set expiry if it's the first attempt in the window
    if (attemptCount === 0) {
      multi.expire(redisKey, 60);
    }
    
    await multi.exec();
    next();
  } catch (err) {
    console.error('Rate limiter error:', err);
    // On cache failure, fall through to prevent locking out users
    next();
  }
};

export const uploadRateLimiter = async (req, res, next) => {
  const ip = req.ip;
  const redisKey = `ratelimit:upload:${ip}`;
  
  try {
    const attempts = await redis.get(redisKey);
    const attemptCount = attempts ? parseInt(attempts, 10) : 0;
    
    // Allow maximum of 10 uploads per 1 minute per IP
    if (attemptCount >= 10) {
      return res.status(429).json({
        success: false,
        message: 'Too many upload attempts. Please try again after a minute.',
      });
    }
    
    const multi = redis.multi();
    multi.incr(redisKey);
    
    // Set expiry if it's the first attempt in the window
    if (attemptCount === 0) {
      multi.expire(redisKey, 60); // 1 minute window (60 seconds)
    }
    
    await multi.exec();
    next();
  } catch (err) {
    console.error('Upload rate limiter error:', err);
    // On cache failure, fall through to prevent locking out users
    next();
  }
};
