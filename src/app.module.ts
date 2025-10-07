import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from './features/supabase/supabase.module';
import { AuthModule } from './features/auth/auth.module';
import { ProductsModule } from './features/products/products.module';
import { CategoriesModule } from './features/categories/categories.module';
import { ProductTagsModule } from './features/product-tags/product-tags.module';
import { UsersModule } from './features/users/users.module';
import { WishlistModule } from './features/wishlist/wishlist.module';
import { CartModule } from './features/cart/cart.module';
import { OrdersModule } from './features/orders/orders.module';
import { DiscountsModule } from './features/discounts/discounts.module';
import { ContactMessagesModule } from './features/contact-messages/contact-messages.module';
import { HealthController } from './health.controller';

/**
 * Main application module that imports all feature modules
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Make configuration available throughout the application
    }),
    SupabaseModule,
    AuthModule,
    ProductsModule,
    CategoriesModule,
    ProductTagsModule,
    UsersModule,
    WishlistModule,
    CartModule,
    OrdersModule,
    DiscountsModule,
    ContactMessagesModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
