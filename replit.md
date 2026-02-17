# Telegram Mini App - Qurtuba Supplies

## Overview
A Telegram bot with a mini web app for managing supplier quotations, built with Node.js/Express and Google Sheets as the backend database.

## Project Architecture
- **Runtime**: Node.js 20
- **Framework**: Express.js serving static HTML/CSS/JS frontend
- **Backend integrations**: Google Sheets API (via `google-spreadsheet`), Telegram Bot API (via `telegraf`), DeepSeek API (for image generation)
- **Entry point**: `index.js` (Express server + Telegram bot)
- **Frontend**: `public/` directory (static HTML, CSS, JS)
- **Port**: 5000 (bound to 0.0.0.0)

## Key Files
- `index.js` - Main server: Express API routes + Telegram bot setup
- `public/index.html` - Login and items list page
- `public/item.html` - Item details and quote submission page
- `public/app.js` - Frontend JavaScript logic
- `public/style.css` - Styles
- `credentials.json` - Google service account credentials
- `.env.example` - Required environment variables template

## Environment Variables Required
- `BOT_TOKEN` - Telegram bot token
- `DEEPSEEK_API_KEY` - DeepSeek API key for image generation
- `GOOGLE_SHEET_ID` - Google Spreadsheet ID

## Google Sheets Structure
- `BOT_USERS` - User authentication data
- `items` - Items/products assigned to employees
- `QUOTATIONS` - Supplier quotation submissions

## Recent Changes
- Configured for Replit: port 5000, bound to 0.0.0.0
- Added cache-control headers for static files
