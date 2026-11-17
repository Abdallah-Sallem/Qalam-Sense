import { AuthService, type AuthConfig } from '@/auth/authService';
import { Db } from '@/data/db';
import { AccountService } from './account';
import { AuditLog } from './audit';
import { ClassroomService } from './classroom';
import { FamilyService } from './family';
import { StudentService } from './studentService';

export interface Services {
  db: Db;
  auth: AuthService;
  audit: AuditLog;
  classroom: ClassroomService;
  family: FamilyService;
  student: StudentService;
  account: AccountService;
}

/** Wires every service to one database. The UI creates this once at start-up. */
export function createServices(db: Db, config: Partial<AuthConfig> = {}): Services {
  const audit = new AuditLog(db, config.now);
  const auth = new AuthService(db, audit, config);
  return {
    db,
    auth,
    audit,
    classroom: new ClassroomService(db, auth, audit),
    family: new FamilyService(db, auth, audit),
    student: new StudentService(db, auth),
    account: new AccountService(db, auth),
  };
}

export async function openServices(config: Partial<AuthConfig> = {}): Promise<Services> {
  return createServices(await Db.open(), config);
}
