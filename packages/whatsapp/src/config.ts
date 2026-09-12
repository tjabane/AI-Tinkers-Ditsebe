export const config = {
 authDir: process.env.WA_AUTH_DIR ?? "./.wa-auth",
 groupsOnly: (process.env.GROUPS_ONLY ?? "true") === "true",
 captureOwn: (process.env.CAPTURE_OWN ?? "false") === "true",
};
