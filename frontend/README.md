# Minutes — frontend

React + Vite + TypeScript frontend for Minutes, a hostel quick-commerce app. Runtime dependencies: `react`, `react-dom`, `react-router-dom`, `firebase`. Nothing else.

## Run

```bash
npm install
npm run dev              # normally http://localhost:5173
npm run build            # type-check + production build
```

For local integration, set `VITE_API_BASE_URL=http://localhost:5000` in `frontend/.env.local`. Preserve any existing Firebase web configuration in that file.

### Preview mode vs. live mode

| Situation | Behaviour |
| --- | --- |
| `npm run dev`, `VITE_API_BASE_URL` empty | **Preview mode.** Sample products/settings, yellow banner, route guards relaxed so you can inspect every screen. Login, payment, saving and admin actions are disabled. |
| `VITE_API_BASE_URL` set (default in `.env.example`: `http://localhost:5000`) | **Live mode.** Everything uses the real backend and Firebase. A server outage is shown as an error; the app does not fall back to sample catalog/settings data. |
| Production build, no `VITE_API_BASE_URL` | Requests fail with a visible error. It never falls back to mock data or fake payments. |

Product/settings preview data lives in `src/data/mockProducts.ts` and is used only by the preview hooks.

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
  data/         mockProducts.ts (preview only)
```

## Backend integration map

All calls go through `src/services/api.ts`. Protected calls send `Authorization: Bearer <firebase-id-token>`.

| Screen | Endpoint | Status |
| --- | --- | --- |
| Home, product details | `GET /api/products`, `GET /api/products/:id` | Wired |
| Store banner, fees | `GET /api/settings` | Wired |
| Account, checkout details | `GET/PUT /api/users/me` | Wired; `floor` is an integer |
| Checkout validation | `POST /api/orders/validate` | Wired; reads the `{ checkout }` response |
| Create order | `POST /api/orders` | Wired; reads and maps the `{ order }` response |
| Customer order history | `GET /api/orders/my` | Wired; requires Firebase authentication and scopes results to the signed-in customer |
| Admin order management | `GET /api/admin/orders`, `PATCH /api/admin/orders/:orderId/status` | Admin-only; lists the latest 100 orders and allows successful paid orders to be marked delivered |
| Payment | `POST /api/orders/:id/payment`, `.../payment/verify` | Wired; reads `{ payment }` and submits Razorpay's snake_case verification fields |
| Admin products | `POST/PUT/DELETE /api/admin/products[/:id]` | Wired |
| Admin image upload | `POST /api/admin/products/images` | Wired; multipart field `image`, response includes `{ imageUrl, publicId }` |
| Admin settings | `GET/PUT /api/admin/settings` | Wired |

Products and settings are returned as raw objects/arrays. Checkout, order creation, and payment endpoints return named envelopes; these contracts are represented in `src/types/order.ts` and mapped at the API boundary.

### Behaviour worth knowing

- The cart stores product snapshots in `localStorage` for display only. Totals shown before validation are labelled *Estimated*; the **Pay** button only enables after `/orders/validate` succeeds and shows the server's total.
- Retrying a dismissed payment reuses the same pending order instead of creating duplicates.
- A Razorpay "success" callback is never trusted: the order is only confirmed from the `/payment/verify` response.
- `amount` from payment init is passed to Razorpay as returned (Razorpay expects paise; the backend converts).
- Stock remains manually managed; the backend checks current availability during checkout validation and order creation.
- `AdminRoute` asks the backend (`GET /api/admin/settings`) whether the user may enter. This is a UX guard; the backend stays authoritative.
- Email/password on the login screen needs the **Email/Password** provider enabled in the Firebase console. Google sign-in needs the Google provider and your dev domain authorized.
- Category filtering is not shown because the backend Product model has no category field.

## Missing APIs (not invented)

1. **Get one order** — e.g. `GET /api/orders/:id`. The confirmation page only has data right after payment (passed via router state).
2. **Admin identity check** — a lightweight endpoint like `GET /api/admin/me` would be cleaner than probing settings.

## Security

No secrets live here. Only public Firebase web config and `VITE_API_BASE_URL` are read from env. The Razorpay Key ID arrives from the backend at payment time; the Key Secret and webhook secret must never be added to this project.
