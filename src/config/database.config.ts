import { ConfigService, registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DEFAULT_POSTGRES_URI } from '../common/variables';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

export const loadPostgresConfig = registerAs('postgres', () => ({
  uri: process.env.POSTGRES_URI || DEFAULT_POSTGRES_URI,
}));

export function getPostgresConfigFactory(configService: ConfigService): TypeOrmModuleOptions {
  return {
    url: configService.get<string>('postgres.uri', DEFAULT_POSTGRES_URI),
    autoLoadEntities: true,
    namingStrategy: new SnakeNamingStrategy(),
    type: 'postgres',
  };
}
