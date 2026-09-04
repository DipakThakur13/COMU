import * as fs from 'fs';
import * as path from 'path';
import { ProjectType } from './types';

export class ProjectDetector {
  public static detect(cwd: string): ProjectType {
    if (fs.existsSync(path.join(cwd, 'package.json'))) {
      if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
        return "TypeScript";
      }
      return "Node";
    }
    if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'requirements.txt'))) {
      return "Python";
    }
    if (fs.existsSync(path.join(cwd, 'go.mod'))) {
      return "Go";
    }
    if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
      return "Rust";
    }
    if (fs.existsSync(path.join(cwd, 'pom.xml')) || fs.existsSync(path.join(cwd, 'build.gradle'))) {
      return "Java";
    }
    
    return "Unknown";
  }
}
