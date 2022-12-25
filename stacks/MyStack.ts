import { Api, Function, StackContext, StaticSite } from '@serverless-stack/resources';
import path from 'path';
import fs from 'fs-extra';
import { HttpMethods } from 'aws-cdk-lib/aws-s3';
import { FunctionBundleProp } from '@serverless-stack/resources/src/Function';

import outputPackageJson from '../app/.output/server/package.json';

/**
 * We retrieve the bundledDependencies in the output package.json. We will need later to create a custom bundling configuration
 */
const bundledDependencies = [...(outputPackageJson.bundledDependencies || [])];

export function MyStack({ stack }: StackContext) {
  /**
   * We create an API that will execute the nuxt lambda handler
   */
  const nuxt = new Api(stack, 'Nuxt', {
    /**
     * We setup a very permissive cors policy for the demo.
     * On production, we will make it stricter
     */
    cors: {
      allowHeaders: ['*'],
      allowMethods: ['ANY'],
      allowOrigins: ['*'],
    },
    /**
     * Uncomment if you want to setup a custom domain
     */
    // customDomain: {
    //   domainName: "",
    //   hostedZone: "",
    // },
  });

  /**
   * Set up the S3 bucket + CloudFront distribution for the public files.
   */
  const publicAsset = new StaticSite(stack, 'PublicAssetCdn', {
    path: './app/.output/public',
    // we wait for CloudFront cache invalidation to avoid any issue. It is increase the build time
    waitForInvalidation: true,
    cdk: {
      /**
       * We setup a very permissive cors policy for the demo.
       * On production, we will make it stricter
       */
      bucket: {
        cors: [
          {
            allowedHeaders: ['*'],
            allowedMethods: [HttpMethods.GET, HttpMethods.DELETE, HttpMethods.HEAD, HttpMethods.POST, HttpMethods.PUT],
            /**
             * Here we provide nuxt api url on the allowed origins
             */
            allowedOrigins: ['*', nuxt.url],
          },
        ],
      },
    },
  });

  /**
   * Set up a default route to handle all call http call to the nuxt application
   */
  nuxt.addRoutes(stack, {
    $default: new Function(stack, 'EntryPointFunc', {
      srcPath: './app/.output/server',
      handler: 'index.handler',
      url: {
        /**
         * We setup a very permissive cors policy for the demo.
         * On production, we will make it stricter
         */
        cors: {
          allowHeaders: ['*'],
          allowMethods: ['*'],
          allowOrigins: ['*'],
        },
      },
      /**
       * We setup a custom bundle configuration to adapt to Nuxt lambda output
       */
      bundle: createBundleConfigurationForNuxtOutput(bundledDependencies),
      /**
       * Here we can provide environment variable
       */
      environment: {
        /**
         * We provide nuxt cdn url for the public folder
         */
        NUXT_APP_CDN_URL: publicAsset.url,
      },
    }),
  });

  /**
   * Show the endpoint in the output
   */
  stack.addOutputs({
    CdnUrl: publicAsset.url,
    NuxtEndpoint: nuxt.url,
  });
}

/**
 * By default, SST bundle and reinstall his dependencies. However, when nuxt build it handle all the bundling for us.
 * We have to update the bundle configuration to tell sst to not bundle again.
 * To do, we need to provide a package.json with all the bundled dependencies with their correct version
 * In the nuxt output, we have already a package.json with the `bundledDependencies`.
 * So, before the install in the sst bundling phase, we update this package.json.
 * We read their package version from the node_modules provide by the nuxt output
 */
function createBundleConfigurationForNuxtOutput(bundledDependencies: string[]): FunctionBundleProp {
  return {
    /**
     * We force esm because nuxt output esm module
     */
    format: 'esm',
    /**
     * We exclude some dependencies from the bundling
     */
    nodeModules: bundledDependencies,
    commandHooks: {
      beforeBundling: () => ["echo 'beforeBundling'"],
      beforeInstall: (inputDir) => {
        const inputPackageJson = fs.readJsonSync(path.join(inputDir, 'package.json'));
        const dependencies = bundledDependencies
          .map((pkg) => {
            let version = 'latest';

            try {
              version = fs.readJsonSync(path.join(inputDir, 'node_modules', pkg, 'package.json'))?.version;
            } catch (e) {}

            return [pkg, version];
          })
          .reduce((acc, [pkg, version]) => {
            acc[pkg] = version;
            return acc;
          }, {} as Record<string, string>);

        fs.writeJSONSync(path.join(inputDir, 'package.json'), {
          ...inputPackageJson,
          dependencies,
        });
        return ["echo 'beforeInstall'"];
      },
      afterBundling: () => ["echo 'afterBundling'"],
    },
  };
}
