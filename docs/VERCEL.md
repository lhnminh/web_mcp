# Deploying Dwellwise to Vercel

## 1. Import the repository

Create a Vercel project and import the GitHub repository. Keep the detected framework preset as **Next.js** and leave the root directory, build command, and output directory at their defaults.

## 2. Connect PostgreSQL

In the Vercel project, open **Storage**, add a Neon Postgres database, and connect it to the project. Confirm that Vercel adds `DATABASE_URL` to the Production, Preview, and Development environments.

Optionally set `NEXT_PUBLIC_SITE_URL` to the final custom-domain URL. When it is omitted, the application uses Vercel's production deployment URL for social preview metadata.

The application creates its anonymous-profile and project storage on the first API request. Existing project tables receive the new nullable browser-owner column automatically.

## 3. Deploy

Deploy the project from the Vercel dashboard. The first visit creates a private anonymous browser profile when the dashboard requests `/api/projects`. Each new apartment is stored under that profile. Subsequent pushes to the production branch deploy automatically.

## 4. Run locally with the connected database

Pull the Vercel environment into `.env.local`, or copy `.env.example` to `.env.local` and replace the placeholder with a PostgreSQL connection string. Then run the normal development command.

Never commit `.env.local` or a real database connection string.
