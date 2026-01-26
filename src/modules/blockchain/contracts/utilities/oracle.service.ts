import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ChainConnectionInfo, RPCInfo } from '../../interfaces';
import { ChainIds, CONNECTION_INFO } from '../../../../common/variables';
import { formatUnits, JsonRpcProvider, parseUnits } from 'ethers';
import { Erc20__factory, Oracle__factory } from '../typechain';

@Injectable()
export class OracleService implements OnModuleInit {
  protected CONTRACT_ADDRESSES: { [key: number]: string };
  private readonly connectionsMap: Map<number, ChainConnectionInfo> = new Map();
  constructor(
    @Inject(CONNECTION_INFO)
    private readonly chainConnectionInfos: ChainConnectionInfo[],
  ) {}

  onModuleInit() {
    this.initialize();
  }

  private initialize() {
    this.initializeContracts();
    this.initializeConnectionsMap();
  }

  private initializeContracts() {
    this.CONTRACT_ADDRESSES = {
      [ChainIds.DUSK_TESTNET]: '0x1Ec4cE240CAb13dd15d144284a93dc8DeD99F41d',
      [ChainIds.PHAROS_TESTNET]: '0xd03a9BE3d61C5d287dA7b23bd7641A6489d0FDd8',
    };
  }

  private initializeConnectionsMap() {
    this.chainConnectionInfos.forEach((connectionInfo) => {
      this.connectionsMap.set(connectionInfo.chainId, connectionInfo);
    });
  }

  private getConnectionInfo(chainId: number) {
    return this.connectionsMap.get(chainId) || ({} as ChainConnectionInfo);
  }

  private provider(rpcInfo: RPCInfo, chainId?: number) {
    return new JsonRpcProvider(rpcInfo.url, chainId);
  }

  private async getERC20Metadata(address: string, chainId: number) {
    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map(async (rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);

      const erc20 = Erc20__factory.connect(address, provider);

      return Promise.all([erc20.decimals(), erc20.symbol(), erc20.name()]);
    });

    const [decimals, symbol, name] = await Promise.any(promises);
    return {
      decimals: parseInt(decimals.toString()),
      symbol,
      name,
    };
  }

  async getPriceInUSD(token: string, chainId: number) {
    const erc20Metadata = await this.getERC20Metadata(token, chainId);
    const ONE = parseUnits('1', erc20Metadata.decimals);
    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map(async (rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);

      const oracle = Oracle__factory.connect(
        this.CONTRACT_ADDRESSES[chainId],
        provider,
      );
      return oracle.getAverageValueInUSD(token, ONE);
    });

    const [price] = await Promise.any(promises);
    return parseFloat(formatUnits(price, 18));
  }

  async getPriceInETH(token: string, chainId: number) {
    const erc20Metadata = await this.getERC20Metadata(token, chainId);
    const ONE = parseUnits('1', erc20Metadata.decimals);
    const connectionInfo = this.getConnectionInfo(chainId);
    const promises = connectionInfo.rpcInfos.map(async (rpcInfo) => {
      const provider = this.provider(rpcInfo, chainId);

      const oracle = Oracle__factory.connect(
        this.CONTRACT_ADDRESSES[chainId],
        provider,
      );
      return oracle.getAverageValueInETH(token, ONE);
    });

    const [price] = await Promise.any(promises);
    return parseFloat(formatUnits(price, 18));
  }
}
