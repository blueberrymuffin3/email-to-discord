FROM node:14
WORKDIR /src
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY src src
CMD [ "node", "." ]
