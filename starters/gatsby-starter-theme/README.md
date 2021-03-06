<p align="center">
  <a href="https://www.gatsbyjs.org">
    <img alt="Gatsby" src="https://www.gatsbyjs.org/monogram.svg" width="60" />
  </a>
</p>
<h1 align="center">
  Starter for the official Gatsby blog and notes themes.
</h1>

Quickly get started using the Gatsby blog theme, and notes theme, together! This starter creates a new Gatsby site that is preconfigured to work with the [blog theme](https://www.npmjs.com/package/gatsby-theme-blog) and the [notes theme](https://www.npmjs.com/package/gatsby-theme-notes), in harmony.

## π Quick start

1.  **Create a Gatsby site.**

    Use the Gatsby CLI to create a new site, specifying this theme starter.

    ```shell
    # create a new Gatsby site using this theme starter
    gatsby new my-themed-site https://github.com/gatsbyjs/gatsby-starter-theme
    ```

2.  **Start developing.**

    Navigate into your new siteβs directory and start it up.

    ```shell
    cd my-themed-site/
    gatsby develop
    ```

3.  **Open the code and start customizing!**

    Your site is now running at `http://localhost:8000`!

    To get started, check out the guide to [getting started with using multiple themes](https://gatsbyjs.org/docs/themes/using-a-gatsby-theme), or the [general themes docs](https://gatsbyjs.org/docs/themes).

## π§ What's inside?

Here are the top-level files and directories you'll see in a site created using this theme starter.

```text
gatsby-starter-theme
βββ content
β   βββ assets
β   β   βββ avatar.jpg
β   βββ notes
β   β   βββ example-dir
β   β   β   βββ hi.mdx
β   β   βββ hello.mdx
β   βββ posts
β       βββ hello-world.mdx
β       βββ my-second-post.mdx
β       βββ new-beginnings.mdx
βββ src
β   βββ gatsby-theme-blog
β   β   βββ components
β   β       βββ header.js
β   βββ gatsby-theme-notes
β       βββ components
β           βββ layout.js
βββ .gitignore
βββ .prettierrc
βββ gatsby-config.js
βββ LICENSE
βββ package.json
```

1.  **`/content`**: A content folder holding assets that the blog and notes themes expect to exist. Check out the README for each theme to learn more about the demo content.

2.  **`/src`**: You will probably want to customize your site to personalize it. The files under `/src/gatsby-theme-blog` and `/src/gatsby-theme-notes` _shadow_, or override the files of the same name in their respective packages. To learn more about this, check out the [guide to getting started with using the blog theme starter](https://gatsbyjs.org/docs/themes/using-a-gatsby-theme).

3.  **`.gitignore`**: This file tells git which files it should not track / not maintain a version history for.

4.  **`.prettierrc`**: This file tells [Prettier](https://prettier.io/) which configuration it should use to lint files.

5.  **`gatsby-config.js`**: This is the main configuration file for a Gatsby site. This is where you can specify information about your site (metadata) like the site title and description, which Gatsby plugins youβd like to include, etc. When using themes, it's where you'll include the theme plugin, and any customization options the theme provides.

6.  **`LICENSE`**: This Gatsby starter is licensed under the 0BSD license. This means that you can see this file as a placeholder and replace it with your own license.

7.  **`package-lock.json`** (See `package.json` below, first). This is an automatically generated file based on the exact versions of your npm dependencies that were installed for your project. **(You wonβt change this file directly).**

8.  **`package.json`**: A manifest file for Node.js projects, which includes things like metadata (the projectβs name, author, etc). This manifest is how npm knows which packages to install for your project.

9.  **`README.md`**: A text file containing useful reference information about your project.

## π Learning Gatsby

Looking for more guidance? Full documentation for Gatsby lives [on the website](https://www.gatsbyjs.org/).

Here are some places to start:

### Themes

- To learn more about Gatsby themes specifically, we recommend checking out the [theme docs](https://www.gatsbyjs.org/docs/themes/).

### General

- **For most developers, we recommend starting with our [in-depth tutorial for creating a site with Gatsby](https://www.gatsbyjs.org/tutorial/).** It starts with zero assumptions about your level of ability and walks through every step of the process.

- **To dive straight into code samples, head [to our documentation](https://www.gatsbyjs.org/docs/).** In particular, check out the _Guides_, _API Reference_, and _Advanced Tutorials_ sections in the sidebar.
