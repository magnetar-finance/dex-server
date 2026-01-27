import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '../../common/variables';

@Injectable()
export class CacheService {
  private readonly logger: Logger = new Logger(CacheService.name);

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: RedisClientType,
  ) {}

  async cache(
    key: string,
    value: string | number | Record<string, any>,
    expiresIn: number = 0,
    nx?: boolean,
  ): Promise<boolean> {
    try {
      value = this.stringifyIfNeeded(value);
      const setOperationValue = await this.client.set(key, value, {
        EX: expiresIn,
        NX: nx,
      });
      return setOperationValue !== null;
    } catch (error: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      this.logger.error('Error occurred while caching', error.stack);
      return false;
    }
  }

  async hCache(
    key: string,
    field: string,
    value: string | number | Record<string, any>,
  ): Promise<boolean> {
    try {
      value = this.stringifyIfNeeded(value);
      const hSetOperationValue = await this.client.hSet(key, field, value);
      return hSetOperationValue === 1;
    } catch (error: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      this.logger.error('Error occurred while caching', error.stack);
      return false;
    }
  }

  async obtain<T>(key: string, del: boolean = false): Promise<T | null> {
    try {
      const cachedValue = await this.client.get(key);
      const parsedValue = cachedValue !== null ? this.parseString<T>(cachedValue) : null;
      if (del) await this.client.del(key);
      return parsedValue;
    } catch (error: any) {
      this.logger.error(
        'Error occurred while obtaining value from cache',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
      return null;
    }
  }

  async hObtain<T>(key: string, field: string, del: boolean = false): Promise<T | null> {
    try {
      const cachedValue = await this.client.hGet(key, field);
      const parsedValue = cachedValue !== null ? this.parseString<T>(cachedValue) : null;
      if (del) await this.client.hDel(key, field);
      return parsedValue;
    } catch (error: any) {
      this.logger.error(
        'Error occurred while obtaining value from cache',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
      return null;
    }
  }

  async hObtainAll(key: string) {
    try {
      const cachedValue = await this.client.hGetAll(key);
      return cachedValue;
    } catch (error: any) {
      this.logger.error(
        'Error occurred while obtaining multiple values from cache',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
      return {};
    }
  }

  async decache(key: string): Promise<boolean> {
    try {
      const operationValue = await this.client.del(key);
      return operationValue === 1;
    } catch (error: any) {
      this.logger.error(
        'Error occurred while deleting value from cache',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
      return false;
    }
  }

  async hDecache(key: string, field: string): Promise<boolean> {
    try {
      const operationValue = await this.client.hDel(key, field);
      return operationValue === 1;
    } catch (error: any) {
      this.logger.error(
        'Error occurred while deleting value from cache',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.stack,
      );
      return false;
    }
  }

  private stringifyIfNeeded(value: string | number | Record<string, any>): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return JSON.stringify(value);
  }

  private parseString<T>(value: string): T {
    try {
      const possibleNumber = parseFloat(value);
      return !isNaN(possibleNumber) ? (possibleNumber as T) : (JSON.parse(value) as T);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error: any) {
      return value as T; // Return the value if parsing fails.
    }
  }
}
