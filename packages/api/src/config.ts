export const config = {
 dbPath: process.env.DB_PATH ?? "./data/messages.db",
 apiPort: Number(process.env.PORT ?? 3000),
};
