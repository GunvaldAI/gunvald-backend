# Gunvald Backend

This repository contains the backend for the Gunvald profile application. It is a simple REST API built with Node.js, Express and PostgreSQL that allows users to register, authenticate, create and update their company profiles, and upload images associated with those profiles.

## Running locally

1. Install dependencies:

```bash
npm install
```

2. Create a PostgreSQL database and run the SQL statements in `schema.sql` to create the necessary tables.

3. Configure environment variables (for example via a `.env` file or your deployment platform) for the database connection and JWT secret:

```bash
DATABASE_URL=postgresql://user:password@host:port/database
JWT_SECRET=supersecret
```

4. Start the server:

```bash
npm start
```

The server will listen on port 3000 by default or the port specified in the `PORT` environment variable.

## Deploying to Railway

To deploy this service to [Railway](https://railway.app), create a new project, connect your GitHub repository, and configure the following environment variables in the Railway dashboard:

- `DATABASE_URL` – the connection string for your PostgreSQL database service on Railway
- `JWT_SECRET` – a secret string used to sign JWT tokens

After adding the environment variables, trigger a deployment. Railway will build the Node.js project and start the server.