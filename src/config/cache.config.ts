import { ConfigService, registerAs } from '@nestjs/config';
import { DEFAULT_NON_SECURE_REDIS_URI } from '../common/variables';
import * as CachingConfig from '../modules/cache/options.config';

export const loadRedisConfig = registerAs('redis', () => ({
  uri: process.env.REDIS_URI || DEFAULT_NON_SECURE_REDIS_URI,
}));

export function getCachingConfigFactory(
  configService: ConfigService,
): CachingConfig.RegistrationOptions {
  return {
    uri: configService.get<string>('redis.uri', DEFAULT_NON_SECURE_REDIS_URI),
  };
}
