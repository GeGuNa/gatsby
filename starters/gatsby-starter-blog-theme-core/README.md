<p align="center">
  <a href="https://www.gatsbyjs.org">
    <img alt="Gatsby" src="https://www.gatsbyjs.org/monogram.svg" width="60" />
  </a>
</p>
<h1 align="center">
  Starter for the official Gatsby blog core theme
</h1>

Quickly get started using the Gatsby blog core theme! This starter creates a new Gatsby site that is preconfigured to work with the [official Gatsby blog core theme](https://www.npmjs.com/package/gatsby-theme-blog-core), allowing you to get started creating a child theme quickly.

## π Quick start

1.  **Create a Gatsby site.**

    Use the Gatsby CLI to create a new site, specifying the blog theme starter.

    ```shell
    # create a new Gatsby site using the blog theme starter
    gatsby new my-themed-blog https://github.com/gatsbyjs/gatsby-starter-blog-theme-core
    ```

2.  **Start developing.**

    Navigate into your new siteβs directory and start it up.

    ```shell
    cd my-themed-blog/
    gatsby develop
    ```

3.  **Open the code and start customizing!**

    Your site is now running at `http://localhost:8000`!

    To get started, check out the guide to [using the Gatsby blog theme starter](https://gatsbyjs.org/docs/themes/using-a-gatsby-theme), or the longer, [more detailed tutorial](https://gatsbyjs.org/tutorial/using-a-theme).

## π§ What's inside?

Here are the top-level files and directories you'll see in a site created using the blog theme starter:

```text
gatsby-starter-blog-theme-core
βββ content
β   βββ assets
β   β   βββ avatar.png
β   βββ posts
β       βββ hello-world.mdx
β       βββ my-second-post.mdx
βββ .gitignore
βββ .prettierrc
βββ gatsby-config.js
βββ LICENSE
βββ package-lock.json
βββ package.json
βββ README.md
```

1.  **`/content`**: A content folder holding assets that the theme expects to exist. This will vary from theme to theme -- this starter is set up to get you started with the blog theme, which expects an image asset for your avatar, and blog post content. Replace the avatar image file, delete the demo posts, and add your own!

2.  **`.gitignore`**: This file tells git which files it should not track / not maintain a version history for.

3.  **`.prettierrc`**: This file tells [Prettier](https://prettier.io/) which configuration it should use to lint files.

4.  **`gatsby-config.js`**: This is the main configuration file for a Gatsby site. This is where you can specify information about your site (metadata) like the site title and description, which Gatsby plugins youβd like to include, etc. When using themes, it's where you'll include the theme plugin, and any customization options the theme provides.

5.  **`LICENSE`**: This Gatsby starter is licensed under the 0BSD license. This means that you can see this file as a placeholder and replace it with your own license.

6.  **`package-lock.json`** (See `package.json` below, first). This is an automatically generated file based on the exact versions of your npm dependencies that were installed for your project. **(You wonβt change this file directly).**

7.  **`package.json`**: A manifest file for Node.js projects, which includes things like metadata (the projectβs name, author, etc). This manifest is how npm knows which packages to install for your project.

8.  **`README.md`**: A text file containing useful reference information about your project.

## π Learning Gatsby

Looking for more guidance? Full documentation for Gatsby lives [on the website](https://www.gatsbyjs.org/).

Here are some places to start:

### Themes

- To learn more about Gatsby themes specifically, we recommend checking out the [theme docs](https://www.gatsbyjs.org/docs/themes/).

### General

- **For most developers, we recommend starting with our [in-depth tutorial for creating a site with Gatsby](https://www.gatsbyjs.org/tutorial/).** It starts with zero assumptions about your level of ability and walks through every step of the process.

- **To dive straight into code samples, head [to our documentation](https://www.gatsbyjs.org/docs/).** In particular, check out the _Reference Guides_ and _Gatsby API_ sections in the sidebar.
