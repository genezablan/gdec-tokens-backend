import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DevelopmentOption } from '../entities/development-option.entity';
import { UpdateDevelopmentOptionDto } from './dto/update-development-option.dto';
import { DevelopmentOptionType } from '../common/enums';
import { S3Service } from '../common/services/s3.service';

@Injectable()
export class DevelopmentOptionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DevelopmentOptionsService.name);

  constructor(
    @InjectRepository(DevelopmentOption)
    private readonly developmentOptionRepository: Repository<DevelopmentOption>,
    private readonly s3Service: S3Service,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seed();
  }

  /**
   * Returns all development options.
   * Employees see only active ones; admins see all.
   */
  async findAll(activeOnly = true): Promise<DevelopmentOption[]> {
    const where = activeOnly ? { isActive: true } : {};
    return this.developmentOptionRepository.find({
      where,
      order: { type: 'ASC' },
    });
  }

  /**
   * Returns a single development option by ID.
   */
  async findOne(id: string): Promise<DevelopmentOption> {
    const option = await this.developmentOptionRepository.findOne({
      where: { id },
    });
    if (!option) {
      throw new NotFoundException(`Development option not found`);
    }
    return option;
  }

  /**
   * Returns a single development option by type.
   */
  async findByType(type: DevelopmentOptionType): Promise<DevelopmentOption> {
    const option = await this.developmentOptionRepository.findOne({
      where: { type },
    });
    if (!option) {
      throw new NotFoundException(`Development option '${type}' not found`);
    }
    return option;
  }

  /**
   * Admin: update name, description, tokenCost, rules, or isActive.
   */
  async update(
    id: string,
    dto: UpdateDevelopmentOptionDto,
    updatedById: string,
  ): Promise<DevelopmentOption> {
    const option = await this.findOne(id);

    Object.assign(option, dto, { updatedById });

    return this.developmentOptionRepository.save(option);
  }

  /**
   * Admin: toggle isActive on/off.
   */
  async toggle(id: string, updatedById: string): Promise<DevelopmentOption> {
    const option = await this.findOne(id);
    option.isActive = !option.isActive;
    option.updatedById = updatedById;
    return this.developmentOptionRepository.save(option);
  }

  /**
   * Admin: upload a form template to S3 and save the URL.
   */
  async uploadFormTemplate(
    id: string,
    file: Express.Multer.File,
    updatedById: string,
  ): Promise<DevelopmentOption> {
    const option = await this.findOne(id);

    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only PDF and Word documents are allowed.',
      );
    }

    const result = await this.s3Service.uploadFile(
      file.buffer,
      `form-templates/${option.type}/${file.originalname}`,
      {
        contentType: file.mimetype,
        metadata: {
          optionType: option.type,
          uploadedById: updatedById,
        },
      },
    );

    option.formTemplateUrl = result.url;
    option.formTemplateFileName = file.originalname;
    option.updatedById = updatedById;

    return this.developmentOptionRepository.save(option);
  }

  /**
   * Seeds the 3 default development options if they don't exist.
   * Called once after migration:run.
   */
  async seed(): Promise<void> {
    const defaults: Partial<DevelopmentOption>[] = [
      {
        type: DevelopmentOptionType.TASK_OFFLOADING,
        name: 'Task Offloading',
        description:
          'Exchange 1 token for 1 OTJ or Special Project (1–3 months).',
        tokenCost: 1,
        isActive: true,
        rules: {
          consecutiveYearRepeatAllowed: false,
          features: [
            '1 token per OTJ or special project',
            'No consecutive-year repeat',
          ],
        },
      },
      {
        type: DevelopmentOptionType.COACHING,
        name: 'Internal Coaching',
        description:
          'Exchange 2 tokens for a coaching cycle of 3 sessions with the same coach.',
        tokenCost: 2,
        isActive: true,
        rules: {
          sessionsRequired: 3,
          sameCoachRequired: true,
          features: ['2 tokens for 3 sessions', 'Same coach per cycle'],
        },
      },
      {
        type: DevelopmentOptionType.LEARNING_SUBSIDY,
        name: 'Learning Subsidy',
        description:
          '1 token = ₱1,000 subsidy for learning and development. Maximum of ₱3,000 (3 tokens).',
        tokenCost: 3,
        isActive: true,
        rules: {
          subsidyPerToken: 1000,
          maxSubsidyAmount: 3000,
          maxTokens: 3,
          features: ['1 token equal to ₱1,000.00', 'Maximum of ₱3,000.00'],
        },
      },
    ];

    for (const data of defaults) {
      const exists = await this.developmentOptionRepository.findOne({
        where: { type: data.type },
      });

      if (exists) {
        // Merge seed rules into existing record so new fields (e.g. features) are added
        // without overwriting admin-customized values like tokenCost or isActive.
        const mergedRules = {
          ...(data.rules as object),
          ...(exists.rules as object),
        };
        await this.developmentOptionRepository.update(exists.id, {
          rules: mergedRules,
        });
        this.logger.verbose(`Updated rules for: ${data.name}`);
      } else {
        await this.developmentOptionRepository.save(
          this.developmentOptionRepository.create(data),
        );
        this.logger.log(`Seeded development option: ${data.name}`);
      }
    }
  }
}
