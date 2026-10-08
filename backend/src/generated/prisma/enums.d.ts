export declare const PaymentStatus: {
    readonly CREATED: 'CREATED';
    readonly PENDING: 'PENDING';
    readonly SUCCESS: 'SUCCESS';
    readonly FAILED: 'FAILED';
    readonly CANCELLED: 'CANCELLED';
    readonly REFUNDED: 'REFUNDED';
};
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export declare const OrderStatus: {
    readonly CONFIRMED: 'CONFIRMED';
    readonly DELIVERED: 'DELIVERED';
};
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
//# sourceMappingURL=enums.d.ts.map