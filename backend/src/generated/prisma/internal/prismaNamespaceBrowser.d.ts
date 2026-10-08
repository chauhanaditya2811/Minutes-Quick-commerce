import * as runtime from "@prisma/client/runtime/index-browser";
export type * from '../models.js';
export type * from './prismaNamespace.js';
export declare const Decimal: typeof runtime.Decimal;
export declare const NullTypes: {
    DbNull: (new (secret: never) => typeof runtime.DbNull);
    JsonNull: (new (secret: never) => typeof runtime.JsonNull);
    AnyNull: (new (secret: never) => typeof runtime.AnyNull);
};
/**
 * Helper for filtering JSON entries that have `null` on the database (empty on the db)
 *
 * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
 */
export declare const DbNull: import("@prisma/client-runtime-utils").DbNullClass;
/**
 * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
 *
 * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
 */
export declare const JsonNull: import("@prisma/client-runtime-utils").JsonNullClass;
/**
 * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
 *
 * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
 */
export declare const AnyNull: import("@prisma/client-runtime-utils").AnyNullClass;
export declare const ModelName: {
    readonly User: 'User';
    readonly Product: 'Product';
    readonly Order: 'Order';
    readonly OrderItem: 'OrderItem';
    readonly Payment: 'Payment';
    readonly PaymentAttempt: 'PaymentAttempt';
    readonly InventoryReservation: 'InventoryReservation';
    readonly Setting: 'Setting';
};
export type ModelName = (typeof ModelName)[keyof typeof ModelName];
export declare const TransactionIsolationLevel: {
    readonly ReadUncommitted: 'ReadUncommitted';
    readonly ReadCommitted: 'ReadCommitted';
    readonly RepeatableRead: 'RepeatableRead';
    readonly Serializable: 'Serializable';
};
export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel];
export declare const UserScalarFieldEnum: {
    readonly id: 'id';
    readonly firebaseUid: 'firebaseUid';
    readonly email: 'email';
    readonly name: 'name';
    readonly profileImage: 'profileImage';
    readonly phone: 'phone';
    readonly hostel: 'hostel';
    readonly floor: 'floor';
    readonly room: 'room';
    readonly createdAt: 'createdAt';
    readonly updatedAt: 'updatedAt';
};
export type UserScalarFieldEnum = (typeof UserScalarFieldEnum)[keyof typeof UserScalarFieldEnum];
export declare const ProductScalarFieldEnum: {
    readonly id: 'id';
    readonly name: 'name';
    readonly imageUrl: 'imageUrl';
    readonly description: 'description';
    readonly price: 'price';
    readonly unit: 'unit';
    readonly stock: 'stock';
    readonly isDeleted: 'isDeleted';
    readonly createdAt: 'createdAt';
    readonly updatedAt: 'updatedAt';
};
export type ProductScalarFieldEnum = (typeof ProductScalarFieldEnum)[keyof typeof ProductScalarFieldEnum];
export declare const OrderScalarFieldEnum: {
    readonly id: 'id';
    readonly orderNumber: 'orderNumber';
    readonly userId: 'userId';
    readonly subtotal: 'subtotal';
    readonly deliveryFee: 'deliveryFee';
    readonly total: 'total';
    readonly paymentStatus: 'paymentStatus';
    readonly orderStatus: 'orderStatus';
    readonly isFiveMinute: 'isFiveMinute';
    readonly customerName: 'customerName';
    readonly customerEmail: 'customerEmail';
    readonly customerImage: 'customerImage';
    readonly customerPhone: 'customerPhone';
    readonly customerHostel: 'customerHostel';
    readonly customerFloor: 'customerFloor';
    readonly customerRoom: 'customerRoom';
    readonly createdAt: 'createdAt';
    readonly deliveredAt: 'deliveredAt';
};
export type OrderScalarFieldEnum = (typeof OrderScalarFieldEnum)[keyof typeof OrderScalarFieldEnum];
export declare const OrderItemScalarFieldEnum: {
    readonly id: 'id';
    readonly orderId: 'orderId';
    readonly productId: 'productId';
    readonly productName: 'productName';
    readonly price: 'price';
    readonly unit: 'unit';
    readonly quantity: 'quantity';
    readonly subtotal: 'subtotal';
};
export type OrderItemScalarFieldEnum = (typeof OrderItemScalarFieldEnum)[keyof typeof OrderItemScalarFieldEnum];
export declare const PaymentScalarFieldEnum: {
    readonly id: 'id';
    readonly orderId: 'orderId';
    readonly razorpayOrderId: 'razorpayOrderId';
    readonly razorpayPaymentId: 'razorpayPaymentId';
    readonly status: 'status';
    readonly amount: 'amount';
    readonly createdAt: 'createdAt';
    readonly updatedAt: 'updatedAt';
};
export type PaymentScalarFieldEnum = (typeof PaymentScalarFieldEnum)[keyof typeof PaymentScalarFieldEnum];
export declare const PaymentAttemptScalarFieldEnum: {
    readonly id: 'id';
    readonly orderId: 'orderId';
    readonly razorpayOrderId: 'razorpayOrderId';
    readonly razorpayPaymentId: 'razorpayPaymentId';
    readonly amount: 'amount';
    readonly status: 'status';
    readonly createdAt: 'createdAt';
};
export type PaymentAttemptScalarFieldEnum = (typeof PaymentAttemptScalarFieldEnum)[keyof typeof PaymentAttemptScalarFieldEnum];
export declare const InventoryReservationScalarFieldEnum: {
    readonly id: 'id';
    readonly productId: 'productId';
    readonly userId: 'userId';
    readonly orderId: 'orderId';
    readonly quantity: 'quantity';
    readonly expiresAt: 'expiresAt';
    readonly consumed: 'consumed';
    readonly createdAt: 'createdAt';
};
export type InventoryReservationScalarFieldEnum = (typeof InventoryReservationScalarFieldEnum)[keyof typeof InventoryReservationScalarFieldEnum];
export declare const SettingScalarFieldEnum: {
    readonly id: 'id';
    readonly storeOpen: 'storeOpen';
    readonly deliveryFee: 'deliveryFee';
    readonly minimumOrder: 'minimumOrder';
    readonly supportEmail: 'supportEmail';
    readonly updatedAt: 'updatedAt';
};
export type SettingScalarFieldEnum = (typeof SettingScalarFieldEnum)[keyof typeof SettingScalarFieldEnum];
export declare const SortOrder: {
    readonly asc: 'asc';
    readonly desc: 'desc';
};
export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder];
export declare const QueryMode: {
    readonly default: 'default';
    readonly insensitive: 'insensitive';
};
export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode];
export declare const NullsOrder: {
    readonly first: 'first';
    readonly last: 'last';
};
export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder];
//# sourceMappingURL=prismaNamespaceBrowser.d.ts.map