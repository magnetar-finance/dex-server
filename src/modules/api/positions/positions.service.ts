import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LiquidityPosition } from '../../../modules/database/entities/lp-position.entity';
import { ILike, Repository } from 'typeorm';

@Injectable()
export class PositionsService {
  constructor(
    @InjectRepository(LiquidityPosition)
    private readonly liquidityPositionRepository: Repository<LiquidityPosition>,
  ) {}

  getLiquidityPositions(account: string, chainId?: number, page: number = 1, limit: number = 20) {
    page = page - 1;
    const offset = page * limit;
    return this.liquidityPositionRepository.find({
      where: {
        account: [{ id: ILike(`%${account}%`) }, { address: ILike(`%${account}%`) }],
        chainId,
      },
      skip: offset,
      take: limit,
      order: { creationBlock: 'DESC' },
    });
  }
}
