# Requirement & Implementation Plan: React + Next.js Authentication & Verification App

This document outlines the architecture, layout, packages configuration, and implementation requirements for creating a new **React + Next.js** frontend application for **FlyBag**. It utilizes the same configuration patterns (ESLint, Prettier, Tailwind CSS v4, Framer Motion) as the mockup landing page, and integrates with the NestJS backend's authentication and user verification APIs.

---

## User Review Required

> [!IMPORTANT]
> - **Tailwind CSS Version**: We will use Tailwind CSS v4 matching the configuration packages used in the `mockup-homepage`.
> - **Prettier & ESLint**: The workspace Prettier settings (`singleQuote: true`, `trailingComma: "all"`) will be configured in the Next.js project automatically.
> - **UI Theme**: The design aesthetics will borrow from the assets in `styles-templates/FlyBag - Final Copy of Designs` (gradients, cards, form visuals, custom buttons) for a premium dark/light glassmorphic look.

---

## Open Questions

> [!IMPORTANT]
> 1. **Project Directory**: Where would you like us to initialize the new Next.js project? We propose `e:\Abhi Project\FlyBag\web-app` (sibling to `site` and `mockup-homepage`).
> 2. **State Management**: Should we use standard React Context or a lightweight state library like Zustand to manage user sessions and tokens?
> 3. **Firebase Cloud Messaging (FCM)**: The registration/login APIs support an optional `fcmToken` (Firebase Cloud Messaging). Should we set up Firebase web notifications placeholder configurations, or skip for this initial phase?

---

## Proposed Configuration & Packages

We will build the Next.js app with the following configuration packages, ensuring consistency:

- **Framework**: Next.js 15+ (App Router)
- **Language**: TypeScript (`tsconfig.json` matching standard strict checks)
- **Styling**: Tailwind CSS v4 (configured via `@tailwindcss/postcss` or Vite-adjacent postcss configurations)
- **Animations**: Framer Motion (for smooth micro-animations, slide transitions, modal pops)
- **Formatting**: ESLint & Prettier (`.prettierrc` mirroring backend settings)
- **API Client**: Axios or native Fetch API with interceptors to automatically append JWT bearer token header

---

## API Endpoints Integration Mapping

The Next.js application will call the NestJS backend (`http://localhost:3000`) for the following actions:

### 1. Authentication Controller (`/auth`)
- **Sign Up**: `POST /auth/register` (Email, password, fcmToken) -> Sets JWT Token.
- **Sign In**: `POST /auth/login` (Email, password, fcmToken) -> Returns JWT Token & Profile.
- **Forgot Password (Send OTP)**: `POST /auth/forgot-password/send-otp` (Email/Phone) -> Sends OTP code.
- **Verify Reset OTP**: `POST /auth/forgot-password/verify-otp` (Email, code) -> Returns temporary Reset Token.
- **Reset Password**: `POST /auth/forgot-password/reset` (token, password) -> Resets password.

### 2. User & Verification Controller (`/users`)
- **Get Dashboard profile info**: `GET /users/me` (requires Bearer JWT) -> User details.
- **Get Active dashboard items**: `GET /users/me/active` (requires Bearer JWT) -> Travel/parcel counts and stats.
- **Send SMS OTP**: `POST /users/verify/mobile/send` (phoneNumber) -> Sends SMS OTP.
- **Verify SMS OTP**: `POST /users/verify/mobile` (phoneNumber, code) -> Verifies phone number (`isPhoneVerified: true`).
- **Get Doc Verify Key**: `GET /users/verify/document/identity_key` -> Obtains identity key.
- **Verify Identity Document**: `GET /users/verify/document` -> Marks profile as document verified (`isDocumentVerified: true`).

---

## Directory Structure

```text
web-app/
├── public/                 # Static assets (logos, icons)
├── src/
│   ├── app/                # Next.js App Router pages
│   │   ├── layout.tsx      # Global layout, fonts, providers
│   │   ├── page.tsx        # Dashboard / Landing Gate check
│   │   ├── login/          # Sign In page
│   │   ├── register/       # Sign Up page
│   │   ├── forgot-password/# Forgot password wizard
│   │   └── verify/         # Verification panel (mobile, document)
│   ├── components/         # Reusable UI Elements (Buttons, Inputs, Modals)
│   │   ├── Card.tsx
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   └── OtpInput.tsx
│   ├── context/            # AuthContext, ToastContext
│   │   └── AuthContext.tsx
│   ├── services/           # API wrapper scripts
│   │   └── api.ts          # Axios / Fetch client configuration
│   └── styles/
│       └── globals.css     # Tailwind v4 directives & root theme variables
├── package.json
├── tsconfig.json
├── tailwind.config.js      # Tailored Tailwind configurations
└── .prettierrc             # Synchronized format settings
```

---

## Verification Plan

### Automated Checks
- `npm run lint` - Runs eslint check to verify code structure and type safety.
- `npm run build` - Builds Next.js app to ensure zero TypeScript or build-time compile errors.

### Manual Verification
1. **User Sign Up & Login**: Register a user account, retrieve profile details, store token in local storage, and verify redirects.
2. **Mobile SMS Verification Flow**: Test sending SMS and entering validation code using test credentials/logs.
3. **Identity Verification**: Initiate document verification simulation and confirm profile status updating inside database/dashboard.
