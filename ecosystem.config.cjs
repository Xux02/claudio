module.exports = {
  apps: [
    {
      name: 'music-api',
      script: './node_modules/.bin/NeteaseCloudMusicApi',
      cwd: __dirname,
      env: { PORT: '4000' },
    },
    {
      name: 'claudio-tts',
      script: 'tts-server.py',
      interpreter: 'python3',
      cwd: __dirname,
    },
    {
      name: 'claudio',
      script: 'src/server.js',
      cwd: __dirname,
    },
  ],
};
