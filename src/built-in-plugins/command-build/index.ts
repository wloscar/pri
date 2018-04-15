import { execSync } from "child_process"
import * as colors from "colors"
import * as fs from "fs-extra"
import * as path from "path"
import * as prettier from "prettier"
import { pri, tempPath } from "../../node"
import { analyseProject } from "../../utils/analyse-project"
import { createEntry } from "../../utils/create-entry"
import { log, spinner } from "../../utils/log"
import { findNearestNodemodulesFile } from "../../utils/npm-finder"
import { plugin } from "../../utils/plugins"
import { getConfig } from "../../utils/project-config"
import { IProjectConfig } from "../../utils/project-config-interface"
import text from "../../utils/text"
import { runWebpack } from "../../utils/webpack"
import { generateStaticHtml } from "./generate-static-html"

const projectRootPath = process.cwd()

export const CommandBuild = async (instance: typeof pri) => {
  const env = "prod"
  const projectConfig = getConfig(projectRootPath, env)

  // Clean dist dir
  execSync(`${findNearestNodemodulesFile(".bin/rimraf")} ${path.join(projectRootPath, projectConfig.distDir)}`)

  // Clean .temp dir
  execSync(`${findNearestNodemodulesFile(".bin/rimraf")} ${path.join(projectRootPath, ".temp")}`)

  const result = await spinner("Analyse project", async () => {
    const analyseInfo = await analyseProject(projectRootPath, env, projectConfig)
    const entryPath = createEntry(projectRootPath, env, projectConfig)
    return { analyseInfo, entryPath }
  })

  // Build project
  const stats = await runWebpack({
    mode: "production",
    projectRootPath,
    env,
    entryPath: result.entryPath,
    projectConfig
  })

  await spinner("Generate static files.", async () => {
    await generateStaticHtml(projectRootPath, projectConfig, result.analyseInfo, stats)
  })

  // Write .temp/static/sw.js
  const tempSwPath = path.join(projectRootPath, tempPath.dir, "static/sw.js")
  const targetSwPath = path.join(projectRootPath, projectConfig.distDir, "sw.js")

  plugin.buildAfterProdBuild.forEach(afterProdBuild => afterProdBuild(stats))

  if (fs.existsSync(tempSwPath)) {
    const tempSwContent = fs.readFileSync(tempSwPath).toString()
    const targetSwContent = instance.pipe.get("serviceWorkerAfterProdBuild", tempSwContent)
    fs.outputFileSync(
      targetSwPath,
      prettier.format(targetSwContent, {
        semi: true,
        singleQuote: true,
        parser: "babylon"
      })
    )
  }
}

export default async (instance: typeof pri) => {
  instance.project.onCreateEntry((analyseInfo, entry, env, projectConfig) => {
    if (env === "prod") {
      entry.pipeHeader(header => {
        return `
          ${header}
          setEnvProd()
        `
      })

      // Set prod env
      entry.pipeBody(body => {
        return `
          ${body}
        `
      })

      // Set custom env
      if (projectConfig.customEnv) {
        entry.pipeBody(body => {
          return `
            ${body}
            setCustomEnv(${JSON.stringify(projectConfig.customEnv)})
          `
        })
      }
    }
  })

  instance.commands.registerCommand({
    name: "build",
    description: text.commander.build.description,
    action: async () => {
      const projectConfig = instance.project.getProjectConfig("prod")
      await instance.project.lint()
      await instance.project.ensureProjectFiles(projectConfig)
      await instance.project.checkProjectFiles(projectConfig)
      await CommandBuild(instance)

      // For async register commander, process will be exit automatic.
      process.exit(0)
    }
  })
}
