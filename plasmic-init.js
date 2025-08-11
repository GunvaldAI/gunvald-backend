import { initPlasmicLoader } from '@plasmicapp/loader-nextjs';

// Initialize the Plasmic loader with your project settings. Replace
// `YOUR_PROJECT_ID` and `YOUR_API_TOKEN` with values from your Plasmic
// console. See docs at https://docs.plasmic.app/loader-nextjs for details.
export const PLASMIC = initPlasmicLoader({
  projects: [
    {
      // Plasmic project ID for the Gunvald site
      id: 'dsfgUZEP7fYaVC0gqpKMU',
      // Public API token for the project
      token: '1vAvnOaFWgJnzbo9a2AMFDTj47RZpiD2VsFFMErS4dga8kLK0i8NmpcDaQUDLdHs5n28wlbERjJ7B6QOd92pg',
    },
  ],
});