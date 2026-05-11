import type { SessionState } from '../types.js';

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionState;
  }
}
