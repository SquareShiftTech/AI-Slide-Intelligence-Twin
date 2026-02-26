export const checkEnvironmentVariables = (): void => {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error(
      'Error: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables are required.'
    );
    console.error('Please refer to the README.md for instructions on obtaining these credentials.');
    process.exit(1);
  }
};
