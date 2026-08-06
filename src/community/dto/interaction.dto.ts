import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * POST /community/:id/react and /comments/:commentId/react.
 * `type` is a free-form reaction value: an emoji grapheme (e.g. "🎉") or a
 * curated GIF reference of the form "gif:<id>".
 */
export class ReactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  type: string;
}

/** POST /community/:id/comments — needs text and/or a GIF (validated in the service). */
export class CreateCommentDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  /** Optional GIF URL posted from the composer (a comment may be GIF-only). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  gifUrl?: string;

  /** @mentioned user IDs (server hydrates names/avatars). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];
}

/** POST /community/:id/vote */
export class VoteDto {
  @IsString()
  @IsNotEmpty()
  optionId: string;
}
