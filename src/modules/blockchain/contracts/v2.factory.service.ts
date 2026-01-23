import { Inject, Injectable } from '@nestjs/common';
import { BaseContractService } from './base';
import { ChainConnectionInfo } from '../interfaces';
import { Factory, Factory__factory } from './typechain';
import { JsonRpcProvider } from 'ethers';
import {
  ChainIds,
  CONNECTION_INFO,
  DEFAULT_BLOCK_RANGE,
} from '../../../common/variables';
import { InjectRepository } from '@nestjs/typeorm';
import { IndexerEventStatus } from '../../database/entities/indexer-event-status.entity';
import { Token } from '../../database/entities/token.entity';
import { Repository } from 'typeorm';
import { Pool, PoolType } from '../../database/entities/pool.entity';

@Injectable()
export class V2FactoryService extends BaseContractService {
  constructor(
    @Inject(CONNECTION_INFO) connectionInfo: ChainConnectionInfo[],
    @InjectRepository(IndexerEventStatus)
    repository: Repository<IndexerEventStatus>,
    @InjectRepository(Token)
    private readonly tokenRepository: Repository<Token>,
    @InjectRepository(Pool) private readonly poolRepository: Repository<Pool>,
  ) {
    super(connectionInfo, repository);
    this.initializeContracts();
  }

  private initializeContracts() {
    this.CONTRACT_ADDRESSES = {
      [ChainIds.DUSK_TESTNET]: '0xE41d241720FEE7cD6BDfA9aB3204d23687703CD5',
      [ChainIds.PHAROS_TESTNET]: '0x68D81F61b88c2622A590719f956f5Dc253a1dC3d',
    };
  }

  private getContract(chainId: number, provider: JsonRpcProvider): Factory {
    const contractAddress = this.CONTRACT_ADDRESSES[chainId];
    return Factory__factory.connect(contractAddress, provider);
  }

  async handlePoolCreated(chainId: number) {
    const indexerEventStatus = await this.getIndexerEventStatus(
      'PoolCreated',
      chainId,
    );
    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map((rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);
      const contract = this.getContract(chainId, provider);
      const blockStart = indexerEventStatus.lastBlockNumber + 1;
      const blockEnd =
        blockStart + (rpcInfo.queryBlockRange || DEFAULT_BLOCK_RANGE);
      return contract.queryFilter(
        contract.filters.PoolCreated,
        blockStart,
        blockEnd,
      );
    });

    const eventData = await Promise.any(promises);

    if (!eventData.length) {
      const latestBlockNumber = await this.getLatestBlockNumber(chainId);
      if (latestBlockNumber)
        indexerEventStatus.lastBlockNumber = latestBlockNumber;
      await this.indexerEventStatusRepository.update(
        { id: indexerEventStatus.id },
        indexerEventStatus,
      );
      return;
    }

    for (const eventDatum of eventData) {
      const processedBlock = eventDatum.blockNumber;
      const { pool, token0, token1, stable } = eventDatum.args;

      const token0Id = `${token0.toLowerCase()}-${chainId}`;
      const token1Id = `${token1.toLowerCase()}-${chainId}`;

      // Find tokens
      let token0Entity = await this.tokenRepository.findOneBy({ id: token0Id });
      let token1Entity = await this.tokenRepository.findOneBy({ id: token1Id });

      if (token0Entity === null) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { name, symbol, decimals } = await this.getERC20Metadata(
          token0,
          chainId,
        );
        token0Entity = this.tokenRepository.create({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          name,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          symbol,
          decimals,
          address: token0,
          chainId,
          totalLiquidity: '0',
          totalLiquidityETH: '0',
          totalLiquidityUSD: '0',
          derivedETH: '0',
          derivedUSD: '0',
          tradeVolume: '0',
          tradeVolumeUSD: '0',
          txCount: 0,
        });
        token0Entity = await this.tokenRepository.save(token0Entity);
      }

      if (token1Entity === null) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { name, symbol, decimals } = await this.getERC20Metadata(
          token1,
          chainId,
        );
        token1Entity = this.tokenRepository.create({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          name,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          symbol,
          decimals,
          address: token0,
          chainId,
          totalLiquidity: '0',
          totalLiquidityETH: '0',
          totalLiquidityUSD: '0',
          derivedETH: '0',
          derivedUSD: '0',
          tradeVolume: '0',
          tradeVolumeUSD: '0',
          txCount: 0,
        });
        token1Entity = await this.tokenRepository.save(token1Entity);
      }

      const poolEntity = this.poolRepository.create({
        address: pool,
        totalBribesUSD: '0',
        chainId,
        reserve0: '0',
        reserve1: '0',
        reserveETH: '0',
        reserveUSD: '0',
        token0: token0Entity,
        token1: token1Entity,
        token0Price: '0',
        token1Price: '0',
        totalEmissions: '0',
        totalEmissionsUSD: '0',
        totalFees0: '0',
        totalFees1: '0',
        totalFeesUSD: '0',
        totalSupply: '0',
        totalVotes: '0',
        txCount: '0',
        volumeETH: '0',
        volumeToken0: '0',
        volumeToken1: '0',
        volumeUSD: '0',
        poolType: stable ? PoolType.STABLE : PoolType.CONCENTRATED,
      });

      // Insert pool
      await this.poolRepository.save(poolEntity);

      // Update indexer status
      indexerEventStatus.lastBlockNumber = processedBlock;
      await this.indexerEventStatusRepository.update(
        { id: indexerEventStatus.id },
        indexerEventStatus,
      );
    }
  }
}
