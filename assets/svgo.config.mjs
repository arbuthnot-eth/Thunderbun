export default {
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          convertPathData: {
            floatPrecision: 0,
            transformPrecision: 0,
            noSpaceAfterFlags: true,
            negativeExtraSpace: true,
          },
          cleanupNumericValues: { floatPrecision: 0 },
          mergePaths: { force: true },
        },
      },
    },
  ],
};
