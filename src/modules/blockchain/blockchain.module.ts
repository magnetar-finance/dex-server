import { DynamicModule, Global, Module } from '@nestjs/common';
import { ChainConnectionInfo } from './interfaces';
import { CONNECTION_INFO } from '../../common/variables';
import { V2PoolService } from './contracts/v2.pool.service';
import { V2FactoryService } from './contracts/v2.factory.service';
import { OracleService } from './contracts/utilities/oracle.service';
import { CLFactoryService } from './contracts/cl.factory.service';

@Global()
@Module({})
export class BlockchainModule {
  static forRoot(chainConnectInfos: ChainConnectionInfo[]): DynamicModule {
    return {
      providers: [
        {
          provide: CONNECTION_INFO,
          useValue: chainConnectInfos,
        },
        V2FactoryService,
        CLFactoryService,
        V2PoolService,
        OracleService,
      ],
      exports: [CONNECTION_INFO, V2FactoryService, CLFactoryService, V2PoolService, OracleService],
      module: BlockchainModule,
    };
  }
}
