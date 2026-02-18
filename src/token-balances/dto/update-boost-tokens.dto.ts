import { IsInt, IsNotEmpty, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateBoostTokensDto {
  /**
   * The new absolute value for boostTokens (not a delta).
   * Must be >= 0. Admin sets the exact boost amount.
   */
  @IsNotEmpty()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  boostTokens: number;
}
