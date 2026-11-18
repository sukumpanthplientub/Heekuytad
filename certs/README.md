# Supabase root CA

`supabase-ca.crt` is the public Supabase Root 2021 CA certificate, downloaded from
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

This is the production certificate URL used by the official Supabase Studio
[`ssl:certificate_url` configuration](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).

The runtime and Prisma CLI add this CA for Supabase URLs and use `sslmode=verify-full`
to verify both the certificate chain and hostname. It contains no private key.
