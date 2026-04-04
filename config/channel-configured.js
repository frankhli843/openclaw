// Bridge for dist-mode jiti resolution.
// dist/loader-*.js uses createJiti(import.meta.url) and loads
// "../config/channel-configured.js", which resolves here when running
// from the bundled dist/ output.
module.exports = require("../src/config/channel-configured.js");
