import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  ParseUUIDPipe,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { DevelopmentOptionsService } from './development-options.service';
import { UpdateDevelopmentOptionDto } from './dto/update-development-option.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../common/enums';

@Controller('development-options')
export class DevelopmentOptionsController {
  constructor(
    private readonly developmentOptionsService: DevelopmentOptionsService,
  ) {}

  /**
   * GET /api/development-options
   * Employees: returns only active options (default)
   * Admins: pass ?all=true to see inactive ones too
   */
  @Get()
  findAll(@Query('all') all: string) {
    const showAll = all === 'true';
    return this.developmentOptionsService.findAll(!showAll);
  }

  /**
   * GET /api/development-options/:id/template/download
   * Returns a short-lived pre-signed S3 URL for downloading the form template.
   * URL expires in 15 minutes. Safe for frontend to open in a new tab.
   */
  @Get(':id/template/download')
  getTemplateDownloadUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.developmentOptionsService.getDownloadUrl(id);
  }

  /**
   * GET /api/development-options/:id
   * Returns a single development option by ID.
   */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.developmentOptionsService.findOne(id);
  }

  /**
   * PATCH /api/development-options/:id
   * Admin only: update name, description, tokenCost, isActive, rules.
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDevelopmentOptionDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.developmentOptionsService.update(id, dto, userId);
  }

  /**
   * PATCH /api/development-options/:id/toggle
   * Admin only: enable or disable a development option.
   */
  @Patch(':id/toggle')
  @Roles(UserRole.ADMIN)
  toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.developmentOptionsService.toggle(id, userId);
  }

  /**
   * GET /api/development-options/:id/template/presigned-upload
   * Admin only: get a pre-signed S3 PUT URL so the browser can upload directly.
   * Query params: fileName, contentType
   */
  @Get(':id/template/presigned-upload')
  @Roles(UserRole.ADMIN)
  getTemplatePresignedUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('fileName') fileName: string,
    @Query('contentType') contentType: string,
  ) {
    if (!fileName || !contentType) {
      throw new BadRequestException('fileName and contentType query params are required');
    }
    return this.developmentOptionsService.getFormTemplatePresignedUpload(id, fileName, contentType);
  }

  /**
   * PATCH /api/development-options/:id/template
   * Admin only: save form template metadata after browser has uploaded directly to S3.
   * Body: { fileUrl, fileName, key }
   */
  @Patch(':id/template')
  @Roles(UserRole.ADMIN)
  saveTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('fileUrl') fileUrl: string,
    @Body('fileName') fileName: string,
    @Body('key') key: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!fileUrl || !fileName || !key) {
      throw new BadRequestException('fileUrl, fileName, and key are required');
    }
    return this.developmentOptionsService.saveFormTemplate(id, fileUrl, fileName, key, userId);
  }

  /**
   * POST /api/development-options/seed
   * Admin only: seed the 3 default development options.
   */
  @Post('seed')
  @Roles(UserRole.ADMIN)
  seed() {
    return this.developmentOptionsService.seed();
  }
}
