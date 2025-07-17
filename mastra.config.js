export default {
  // Basic configuration
  build: {
    // Include the data directory in the output
    copyFiles: [
      {
        from: 'src/mastra/data',
        to: '.mastra/output/data'
      }
    ]
  }
};
