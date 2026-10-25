import type { AuthUser } from '../../shared/protocol';
import type { SessionDocument } from '../models/Session';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        session: SessionDocument;
        user: AuthUser;
      };
    }
  }
}

export {};
