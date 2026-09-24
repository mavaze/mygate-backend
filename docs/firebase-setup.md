# Firebase setup

1. Open the Firebase console.
2. Create a dedicated My Gate project.
3. Enable Authentication.
4. Record the Firebase Project ID.
5. Do not place any Firebase service-account private key in this repository or APK.

## Later production configuration

Enable Firebase App Check for the Android package and use Play Integrity as the production provider.

Development/ADB installation can be tested without making Play Integrity a prerequisite to the backend implementation.

The Worker will ultimately validate both Firebase identity and the appropriate App Check token for protected production endpoints.
