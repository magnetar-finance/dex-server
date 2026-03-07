import { ModuleMetadata } from '@nestjs/common';

export interface RegistrationOptions {
  uri?: string;
  isSecure?: boolean;
  username?: string;
  password?: string;
  host?: string;
  port?: number;
}

export interface RegistrationAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory?: (...args: any[]) => Promise<RegistrationOptions> | RegistrationOptions;
  inject?: any[];
}
