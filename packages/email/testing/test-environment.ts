/**
 * Test runs share the deployed test domain, so addresses built with
 * `testEmailAddress` route to Console exactly as they do in Preview.
 */
process.env.EMAIL_TEST_DOMAIN ??= "deskohub.test";
