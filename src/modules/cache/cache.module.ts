import {
  DynamicModule,
  Global,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import { CacheService } from './cache.service';
import { ModuleRef } from '@nestjs/core';
import { createClient, type RedisClientType } from 'redis';
import { RegistrationAsyncOptions, RegistrationOptions } from './options.config';
import {
  DEFAULT_NON_SECURE_REDIS_URI,
  DEFAULT_SECURE_REDIS_URI,
  REDIS_CLIENT,
  REDIS_CLIENT_CONFIG,
} from '../../common/variables';

@Global()
@Module({})
export class CacheModule implements OnApplicationShutdown, OnApplicationBootstrap {
  constructor(private readonly moduleRef: ModuleRef) {}

  static register(
    opts: RegistrationOptions = {
      uri: DEFAULT_NON_SECURE_REDIS_URI,
      isSecure: false,
    },
  ): DynamicModule {
    if (opts.isSecure)
      opts.uri =
        opts.host && opts.username && opts.password && opts.port
          ? `redis://${opts.username}:${opts.password}@${opts.host}:${opts.port}`
          : DEFAULT_SECURE_REDIS_URI;
    return {
      module: CacheModule,
      providers: [
        {
          provide: REDIS_CLIENT,
          useValue: createClient({
            url: opts.uri,
          }),
        },
        CacheService,
      ],
      exports: [REDIS_CLIENT, CacheService],
    };
  }

  static registerAsync(
    opts: RegistrationAsyncOptions = {
      useFactory: () => ({
        uri: DEFAULT_NON_SECURE_REDIS_URI,
        isSecure: false,
      }),
    },
  ): DynamicModule {
    const otherProviders: Provider[] = [
      {
        provide: REDIS_CLIENT_CONFIG,
        useFactory: opts.useFactory
          ? opts.useFactory
          : () => ({
              uri: DEFAULT_NON_SECURE_REDIS_URI,
              isSecure: false,
            }),
        inject: opts.inject || [],
      },
    ];

    return {
      module: CacheModule,
      providers: [
        ...otherProviders,
        {
          provide: REDIS_CLIENT,
          useFactory: (config: RegistrationOptions) => {
            if (config.isSecure)
              config.uri =
                config.host && config.username && config.password && config.port
                  ? `redis://${config.username}:${config.password}@${config.host}:${config.port}`
                  : DEFAULT_SECURE_REDIS_URI;

            return createClient({
              url: config.uri,
            });
          },
          inject: [REDIS_CLIENT_CONFIG],
        },
        CacheService,
      ],
      exports: [REDIS_CLIENT, CacheService],
    };
  }

  onApplicationShutdown() {
    const redisClient = this.moduleRef.get<RedisClientType>(REDIS_CLIENT);
    if (redisClient.isOpen || redisClient.isReady || redisClient.isWatching) redisClient.destroy();
  }

  async onApplicationBootstrap() {
    const redisClient = this.moduleRef.get<RedisClientType>(REDIS_CLIENT);
    if (redisClient) await redisClient.connect();
  }
}
