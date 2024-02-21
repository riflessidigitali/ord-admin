Project Automation Action
===================

GitHub workflow action to copy the project automation workflow across company's repositories

---

## Install and Build

Run `npm install` to install the required deps.

To build the action you might want to run `npm run build`. 
The build process will generate two files:
- the action build file located at [./dist/index.js](./dist/index.js) 
- a license file located at [./dist/licenses.text](./dist/licenses.txt) listing the licenses for every dependency used by this action, and this action's license itself.

## Coding Standards

Run `npm run cs-check` to run eslint, and `npm run cs-fix` to automatically fix fixable coding standard issues.
