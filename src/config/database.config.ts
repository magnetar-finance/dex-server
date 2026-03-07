import { ConfigService, registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DEFAULT_POSTGRES_URI } from '../common/variables';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

export const loadPostgresConfig = registerAs('postgres', () => ({
  uri: process.env.POSTGRES_URI || DEFAULT_POSTGRES_URI,
  secureDB: Boolean(process.env.SECURE_DB),
  ca: process.env.CA,
}));

export function getPostgresConfigFactory(configService: ConfigService): TypeOrmModuleOptions {
  const isSecure = configService.get<boolean>('postgres.secureDB', false);
  const ca = configService.get<string>('postgres.ca', '').replace(/\\n/g, '\n');
  return {
    url: configService.get<string>('postgres.uri', DEFAULT_POSTGRES_URI),
    autoLoadEntities: true,
    namingStrategy: new SnakeNamingStrategy(),
    type: 'postgres',
    ssl: isSecure
      ? {
          rejectUnauthorized: true,
          ca,
        }
      : false,
  };
}
