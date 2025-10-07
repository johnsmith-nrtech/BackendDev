import { IsUUID, IsInt, Min, IsArray, ArrayMinSize, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CartItemDto {
  @ApiProperty({
    description: 'Product variant ID to add to cart',
    example: '123e4567-e89b-12d3-a456-426614174001',
    type: String
  })
  @IsUUID('4')
  variant_id: string;

  @ApiProperty({
    description: 'Quantity of items to add',
    example: 1,
    minimum: 1,
    default: 1
  })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class UpdateCartItemDto {
  @ApiProperty({
    description: 'Updated quantity of the item',
    example: 2,
    minimum: 1
  })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class DeleteCartItemsDto {
  @ApiProperty({
    description: 'Array of cart item IDs to delete',
    example: ['123e4567-e89b-12d3-a456-426614174001', '123e4567-e89b-12d3-a456-426614174002'],
    type: [String],
    isArray: true
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one item ID must be provided' })
  @IsUUID('4', { each: true, message: 'Each item ID must be a valid UUID' })
  item_ids: string[];
} 