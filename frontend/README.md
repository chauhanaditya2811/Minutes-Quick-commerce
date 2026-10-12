# Minutes — frontend

React + Vite + TypeScript frontend for Minutes, a hostel quick-commerce app. Runtime dependencies: `react`, `react-dom`, `react-router-dom`, `firebase`. Nothing else.

## Run

```bash
npm install
cp .env.example .env     # optional for preview; required to connect the backend
npm run dev              # http://localhost:5173
npm run build            # type-check + production build
```

### Preview mode vs. live mode

| Situation | Behaviour |
| --- | --- |
| `npm run dev`, `VITE_API_BASE_URL` empty | **Preview mode.** Sample products/settings, yellow banner, route guards relaxed so you can inspect every screen. Login, payment, saving and admin actions are disabled. |
| `VITE_API_BASE_URL` set (e.g. `http://localhost:5000`) | **Live mode.** Everything uses the real backend and Firebase. No mock data. |
| Production build, no `VITE_API_BASE_URL` | Requests fail with a visible error. It never falls back to mock data or fake payments. |

Mock code lives only in `src/data/`, and is reached only through `src/hooks/useProducts.ts` and `useStoreSettings.ts`.

## Structure

```
src/
  components/   Navbar, Footer, Loading, layout/, products/, cart/, checkout/, admin/, ui/
  context/      AuthContext (Firebase + profile), CartContext (localStorage-persisted)
  firebase/     firebase.ts (null-safe when unconfigured)
  hooks/        useAsync, useProducts, useStoreSettings
  pages/        home, products, cart, checkout, orders, account, auth, dashboard
  routers/      router.tsx, PrivateRoute, AdminRoute
  services/     api.ts (all backend calls), razorpay.ts, config.ts
  types/        product.ts, order.ts, user.ts
  data/         mockProducts.ts, mockOrders.ts, productCategories.ts (preview/presentation only)
```

## Backend integration map

All calls go through `src/services/api.ts`. Protected calls send `Authorization: Bearer <firebase-id-token>`.

| Screen | Endpoint | Status |
| --- | --- | --- |
| Home, product details | `GET /api/products`, `GET /api/products/:id` | Wired |
| Store banner, fees | `GET /api/settings` | Wired |
| Account, checkout details | `GET/PUT /api/users/me` | Wired (field names unconfirmed) |
| Checkout validation | `POST /api/orders/validate` | Wired (response shape unconfirmed) |
| Create order | `POST /api/orders` | Wired (response shape unconfirmed) |
| Payment | `POST /api/orders/:id/payment`, `.../payment/verify` | Wired (shapes unconfirmed) |
| Admin products | `POST/PUT/DELETE /api/admin/products[/:id]` | Wired |
| Admin image upload | `POST /api/admin/products/images` | Wired (multipart field `image`, response `{imageUrl}` assumed) |
| Admin settings | `GET/PUT /api/admin/settings` | Wired |

**Unconfirmed shapes** are isolated in `src/types/*.ts` and the `unwrap()` helper in `api.ts`. Check them against your controllers first. Likely tweaks: wrapper keys (`{ products }`, `{ order }`), the Razorpay init fields (`razorpayOrderId`, `amount`, `currency`, `keyId`), the verify body field names, and the profile image field name.

### Behaviour worth knowing

- The cart stores product snapshots in `localStorage` for display only. Totals shown before validation are labelled *Estimated*; the **Pay** button only enables after `/orders/validate` succeeds and shows the server's total.
- Retrying a dismissed payment reuses the same pending order instead of creating duplicates.
- A Razorpay "success" callback is never trusted: the order is only confirmed from the `/payment/verify` response.
- `amount` from payment init is passed to Razorpay as returned (Razorpay expects paise; the backend converts).
- `AdminRoute` asks the backend (`GET /api/admin/settings`) whether the user may enter. This is a UX guard; the backend stays authoritative.
- Email/password on the login screen needs the **Email/Password** provider enabled in the Firebase console. Google sign-in needs the Google provider and your dev domain authorized.
- Categories are guessed from product names in `data/productCategories.ts` (frontend-only; the Product model has no category).

## Missing APIs (not invented)

1. **Customer order history** — e.g. `GET /api/orders` (current user's orders). `OrdersPage` currently shows labelled sample data.
2. **Get one order** — e.g. `GET /api/orders/:id`. The confirmation page only has data right after payment (passed via router state).
3. **Admin order management** — list all orders and update status (`CONFIRMED` → `DELIVERED`, cancel). `OrdersShell` is an empty UI shell.
4. **Admin identity check** — a lightweight endpoint like `GET /api/admin/me` would be cleaner than probing settings.

## Security

No secrets live here. Only public Firebase web config and `VITE_API_BASE_URL` are read from env. The Razorpay Key ID arrives from the backend at payment time; the Key Secret and webhook secret must never be added to this project.
