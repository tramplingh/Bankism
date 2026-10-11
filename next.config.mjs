/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prompt templates live in /prompts as plain markdown (judges can read them);
  // make sure the serverless bundle ships them.
  outputFileTracingIncludes: {
    "/api/analyze": ["./prompts/**/*"],
  },
};
export default nextConfig;
