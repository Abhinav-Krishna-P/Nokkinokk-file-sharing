import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPassword = process.env.REDIS_PASSWORD || undefined;

const redisOptions = {
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: null,
};

if (redisPassword) {
  redisOptions.password = redisPassword;
}

const redis = new Redis(redisOptions);

redis.on('connect', () => {
  console.log('Successfully connected to Redis.');
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

export default redis;
