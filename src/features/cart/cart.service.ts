import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CartItemDto } from './dto';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Get cart items for authenticated user with detailed variant and product information
   */
  async getUserCart(userId: string) {
    try {
      const supabase = this.supabaseService.getClient();
      
      // First, get or create the user's cart
      const { data: cart, error: cartError } = await supabase
        .from('carts')
        .select('id, created_at, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (cartError) {
        this.logger.error(`Error fetching user cart: ${cartError.message}`);
        throw new BadRequestException('Failed to fetch cart');
      }

      let cartId: string;
      let cartCreatedAt: string;
      let cartUpdatedAt: string;
      
      // If no cart exists, create one for the user
      if (!cart) {
        const { data: newCart, error: createError } = await supabase
          .from('carts')
          .insert({
            user_id: userId
          })
          .select('id, created_at, updated_at')
          .single();
        
        if (createError) {
          this.logger.error(`Error creating cart: ${createError.message}`);
          throw new BadRequestException('Failed to create cart');
        }
        
        cartId = newCart.id;
        cartCreatedAt = newCart.created_at;
        cartUpdatedAt = newCart.updated_at;
      } else {
        cartId = cart.id;
        cartCreatedAt = cart.created_at;
        cartUpdatedAt = cart.updated_at;
      }
      
      // Remove items from cart that have been purchased in paid orders
      await this.removePurchasedItemsFromCart(userId, cartId);
      
      // Fetch cart items with detailed variant and product information
      const { data: items, error: itemsError } = await supabase
        .from('cart_items')
        .select(`
          id,
          quantity,
          created_at,
          updated_at,
          variant:product_variants(
            id,
            product_id,
            sku,
            price,
            size,
            color,
            stock,
            tags,
            material,
            brand,
            featured,
            created_at,
            updated_at,
            product:products(
              id,
              name,
              description,
              category_id,
              base_price,
              created_at,
              updated_at,
              category:categories(
                id,
                name,
                slug,
                parent_id,
                description,
                order,
                image_url,
                featured,
                created_at,
                updated_at
              )
            ),
            variant_images:product_images!variant_id(
              id,
              url,
              type,
              order,
              created_at,
              updated_at
            )
          )
        `)
        .eq('cart_id', cartId)
        .order('created_at', { ascending: false });
      
      if (itemsError) {
        this.logger.error(`Error fetching cart items: ${itemsError.message}`);
        throw new BadRequestException('Failed to fetch cart items');
      }

      // Also get product-level images for each item
      const itemsWithImages = await Promise.all(
        (items || []).map(async (item: any) => {
          if (item.variant?.product) {
            // Get product-level images (not variant-specific)
            const { data: productImages, error: imageError } = await supabase
              .from('product_images')
              .select('id, url, type, order, created_at, updated_at')
              .eq('product_id', item.variant.product.id)
              .is('variant_id', null)
              .order('order');

            if (!imageError && productImages) {
              item.variant.product.images = productImages;
            }
          }
          return item;
        })
      );
      
      return {
        id: cartId,
        user_id: userId,
        items: itemsWithImages || [],
        created_at: cartCreatedAt,
        updated_at: cartUpdatedAt
      };
    } catch (error) {
      this.logger.error(`Error in getUserCart: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove items from cart that have been purchased in paid orders
   */
  private async removePurchasedItemsFromCart(userId: string, cartId: string) {
    try {
      const supabase = this.supabaseService.getClient();
      
      // Get all variant IDs from paid orders for this user
      const { data: paidOrderItems, error: paidOrderError } = await supabase
        .from('order_items')
        .select(`
          variant_id,
          order:orders!inner(
            id,
            user_id,
            status
          )
        `)
        .eq('order.user_id', userId)
        .eq('order.status', 'paid');

      if (paidOrderError) {
        this.logger.error(`Error fetching paid order items: ${paidOrderError.message}`);
        return; // Don't throw error, just log and continue
      }

      if (!paidOrderItems || paidOrderItems.length === 0) {
        return; // No paid orders, nothing to remove
      }

      // Extract unique variant IDs from paid orders
      const purchasedVariantIds = [...new Set(
        paidOrderItems.map(item => item.variant_id).filter(Boolean)
      )];

      if (purchasedVariantIds.length === 0) {
        return;
      }

      this.logger.log(`Found ${purchasedVariantIds.length} purchased variants for user ${userId}, removing from cart`);

      // Remove cart items that contain purchased variants
      const { data: removedItems, error: removeError } = await supabase
        .from('cart_items')
        .delete()
        .eq('cart_id', cartId)
        .in('variant_id', purchasedVariantIds)
        .select('id, variant_id');

      if (removeError) {
        this.logger.error(`Error removing purchased items from cart: ${removeError.message}`);
        return; // Don't throw error, just log and continue
      }

      if (removedItems && removedItems.length > 0) {
        this.logger.log(`Removed ${removedItems.length} purchased items from cart for user ${userId}`);
        
        // Update cart's updated_at timestamp
        await supabase
          .from('carts')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', cartId);
      }

    } catch (error) {
      this.logger.error(`Error in removePurchasedItemsFromCart: ${error.message}`);
      // Don't throw error, just log and continue to prevent breaking cart functionality
    }
  }

  /**
   * Add item to user's cart
   */
  async addToCart(userId: string, item: CartItemDto) {
    try {
      const supabase = this.supabaseService.getClient();
      
      // Verify that the product variant exists and has enough stock
      const { data: variant, error: variantError } = await supabase
        .from('product_variants')
        .select('id, stock')
        .eq('id', item.variant_id)
        .single();
      
      if (variantError || !variant) {
        throw new NotFoundException('Product variant not found');
      }
      
      // Check stock availability
      if (variant.stock < item.quantity) {
        throw new BadRequestException(`Not enough stock available. Available: ${variant.stock}`);
      }
      
      // Get or create the user's cart
      const { data: cart, error: cartError } = await supabase
        .from('carts')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      let cartId: string;

      if (!cart) {
        // Create new cart for user
        const { data: newCart, error: createError } = await supabase
          .from('carts')
          .insert({
            user_id: userId
          })
          .select('id')
          .single();
        
        if (createError) {
          this.logger.error(`Error creating cart: ${createError.message}`);
          throw new BadRequestException('Failed to create cart');
        }
        
        cartId = newCart.id;
      } else {
        cartId = cart.id;
      }

      // Check if item already exists in cart
      const { data: existingItem, error: existingError } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('cart_id', cartId)
        .eq('variant_id', item.variant_id)
        .maybeSingle();

      if (existingError) {
        this.logger.error(`Error checking existing item: ${existingError.message}`);
        throw new BadRequestException('Failed to check existing cart item');
      }

      let result;

      if (existingItem) {
        // Update existing item quantity
        const newQuantity = existingItem.quantity + item.quantity;
        
        // Check stock for new total quantity
        if (variant.stock < newQuantity) {
          throw new BadRequestException(`Not enough stock available. Available: ${variant.stock}, requested total: ${newQuantity}`);
        }

        const { data: updatedItem, error: updateError } = await supabase
          .from('cart_items')
          .update({ 
            quantity: newQuantity,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingItem.id)
          .select('id, cart_id, variant_id, quantity, created_at, updated_at')
          .single();

        if (updateError) {
          this.logger.error(`Error updating cart item: ${updateError.message}`);
          throw new BadRequestException('Failed to update cart item');
        }

        result = updatedItem;
      } else {
        // Add new item to cart
        const { data: newItem, error: addError } = await supabase
          .from('cart_items')
          .insert({
            cart_id: cartId,
            variant_id: item.variant_id,
            quantity: item.quantity
          })
          .select('id, cart_id, variant_id, quantity, created_at, updated_at')
          .single();

        if (addError) {
          // Handle unique constraint violation (race condition case)
          if (addError.code === '23505' || addError.message.includes('duplicate key') || addError.message.includes('unique')) {
            this.logger.log(`Duplicate cart item detected during race condition for user ${userId}, variant ${item.variant_id}`);
            
            // Get the existing item that was created by another request
            const { data: raceConditionItem } = await supabase
              .from('cart_items')
              .select('id, quantity')
              .eq('cart_id', cartId)
              .eq('variant_id', item.variant_id)
              .single();
            
            if (raceConditionItem) {
              // Update the existing item with the requested quantity
              const newQuantity = raceConditionItem.quantity + item.quantity;
              
              // Check stock for new total quantity
              if (variant.stock < newQuantity) {
                throw new BadRequestException(`Not enough stock available. Available: ${variant.stock}, requested total: ${newQuantity}`);
              }
              
              const { data: updatedItem, error: updateError } = await supabase
                .from('cart_items')
                .update({ 
                  quantity: newQuantity,
                  updated_at: new Date().toISOString()
                })
                .eq('id', raceConditionItem.id)
                .select('id, cart_id, variant_id, quantity, created_at, updated_at')
                .single();
              
              if (updateError) {
                this.logger.error(`Error updating cart item after race condition: ${updateError.message}`);
                throw new BadRequestException('Failed to update cart item');
              }
              
              return {
                success: true,
                message: 'Item added to cart',
                item: updatedItem
              };
            }
          }
          
          this.logger.error(`Error adding to cart: ${addError.message}`);
          throw new BadRequestException('Failed to add item to cart');
        }

        result = newItem;
      }

      return {
        success: true,
        message: 'Item added to cart',
        item: result
      };
    } catch (error) {
      this.logger.error(`Error in addToCart: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update cart item quantity
   */
  async updateCartItem(userId: string, itemId: string, quantity: number) {
    try {
      const supabase = this.supabaseService.getClient();
      
      // First, verify that the cart item belongs to the user
      const { data: cartItem, error: itemError } = await supabase
        .from('cart_items')
        .select(`
          id,
          variant_id,
          quantity,
          carts!inner(user_id)
        `)
        .eq('id', itemId)
        .eq('carts.user_id', userId)
        .single();

      if (itemError || !cartItem) {
        throw new NotFoundException('Cart item not found');
      }

      // Check stock availability for the variant
      const { data: variant, error: variantError } = await supabase
        .from('product_variants')
        .select('stock')
        .eq('id', cartItem.variant_id)
        .single();

      if (variantError || !variant) {
        throw new NotFoundException('Product variant not found');
      }

      if (variant.stock < quantity) {
        throw new BadRequestException(`Requested quantity (${quantity}) exceeds available stock (${variant.stock})`);
      }

      // Update the cart item
      const { data: updatedItem, error: updateError } = await supabase
        .from('cart_items')
        .update({ 
          quantity,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId)
        .select('id, cart_id, variant_id, quantity, created_at, updated_at')
        .single();

      if (updateError) {
        this.logger.error(`Error updating cart item: ${updateError.message}`);
        throw new BadRequestException('Failed to update cart item');
      }

      return {
        success: true,
        message: 'Cart item updated',
        item: updatedItem
      };
    } catch (error) {
      this.logger.error(`Error in updateCartItem: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove item from cart
   */
  async removeCartItem(userId: string, itemId: string) {
    try {
      const supabase = this.supabaseService.getClient();
      
      // First, verify that the cart item belongs to the user
      const { data: cartItem, error: itemError } = await supabase
        .from('cart_items')
        .select(`
          id,
          cart_id,
          variant_id,
          quantity,
          carts!inner(user_id)
        `)
        .eq('id', itemId)
        .eq('carts.user_id', userId)
        .single();

      if (itemError || !cartItem) {
        throw new NotFoundException('Cart item not found');
      }

      // Now delete the verified cart item
      const { data: deletedItem, error: deleteError } = await supabase
        .from('cart_items')
        .delete()
        .eq('id', itemId)
        .select('id, cart_id, variant_id, quantity, created_at')
        .single();

      if (deleteError) {
        this.logger.error(`Error deleting cart item: ${deleteError.message}`);
        throw new BadRequestException('Failed to remove cart item');
      }

      return {
        success: true,
        message: 'Item removed from cart'
      };
    } catch (error) {
      this.logger.error(`Error in removeCartItem: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove multiple items from cart
   */
  async removeCartItems(userId: string, itemIds: string[]) {
    try {
      const supabase = this.supabaseService.getClient();
      
      // First, verify that all cart items belong to the user
      const { data: cartItems, error: itemsError } = await supabase
        .from('cart_items')
        .select(`
          id,
          cart_id,
          variant_id,
          quantity,
          carts!inner(user_id)
        `)
        .in('id', itemIds)
        .eq('carts.user_id', userId);

      if (itemsError) {
        this.logger.error(`Error verifying cart items: ${itemsError.message}`);
        throw new BadRequestException('Failed to verify cart items');
      }

      // Check if all requested items were found and belong to the user
      if (!cartItems || cartItems.length !== itemIds.length) {
        const foundIds = cartItems?.map(item => item.id) || [];
        const notFoundIds = itemIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(`Cart items not found: ${notFoundIds.join(', ')}`);
      }

      // Delete all verified cart items
      const { data: deletedItems, error: deleteError } = await supabase
        .from('cart_items')
        .delete()
        .in('id', itemIds)
        .select('id, cart_id, variant_id, quantity, created_at');

      if (deleteError) {
        this.logger.error(`Error deleting cart items: ${deleteError.message}`);
        throw new BadRequestException('Failed to remove cart items');
      }

      return {
        success: true,
        message: `Successfully removed ${deletedItems?.length || 0} items from cart`,
        deleted_items: deletedItems || []
      };
    } catch (error) {
      this.logger.error(`Error in removeCartItems: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clear all items from user's cart
   */
  async clearCart(userId: string) {
    try {
      const supabase = this.supabaseService.getClient();
      
      // Get user's cart
      const { data: cart, error: cartError } = await supabase
        .from('carts')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (cartError || !cart) {
        throw new NotFoundException('Cart not found');
      }

      // Delete all items from the cart
      const { error: deleteError } = await supabase
        .from('cart_items')
        .delete()
        .eq('cart_id', cart.id);

      if (deleteError) {
        this.logger.error(`Error clearing cart: ${deleteError.message}`);
        throw new BadRequestException('Failed to clear cart');
      }

      return {
        success: true,
        message: 'Cart cleared successfully'
      };
    } catch (error) {
      this.logger.error(`Error in clearCart: ${error.message}`);
      throw error;
    }
  }
} 