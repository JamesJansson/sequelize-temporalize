# Temporalize tables for Sequelize

(aka "Historical records")

This package is a derivative of [sequelize-temporal](https://www.npmjs.com/package/sequelize-temporal), with some bug fixes and major changes merged in. The project is now a substantial divergence from [sequelize-temporal](https://www.npmjs.com/package/sequelize-temporal), so it is no longer interchangeable.

## What is it?

Temporalize tables maintain **historical versions** of data. Modifying operations (UPDATE, DELETE) on these tables don't cause permanent changes to entries, but create new versions of them. Hence this might be used to:

- log changes (security/auditing)
- undo functionalities
- track interactions (customer support)

Under the hood a history table with the same structure, but without constraints is created (unless option **addAssociation** is set to **true**).

The normal singular/plural naming scheme in Sequelize is used:

- model name: `modelName + 'History'`
- table name: `modelName + 'Histories'`
- index name: `indexName + '_history'`

## Installation

```bash
npm install sequelize-temporalize
```

## How to use

### 1) Import `sequelize-temporalize`

```js
var Sequelize = require('sequelize');
var Temporalize = require('sequelize-temporalize');
```

or using imports

```js
import { Sequelize, Model, UUID, UUIDV4 } from 'sequelize';
import { Temporalize } from 'sequelize-temporalize';
```

Create a sequelize instance and your models, e.g.

```js
var sequelize = new Sequelize('', '', '', {
  dialect: 'sqlite',
  storage: __dirname + '/.test.sqlite'
});
```

### 2) Add the _temporalize_ feature to your models

```js
var User = sequelize.define('User', {paranoid: true});
// paranoid: true necessary to keep track of deleted entries in history table
var UserHistory = Temporalize({
    model: User,
    sequelize: sequelize,
    temporalizeOptions: {/* some options can be put here */});
```

or using es6 classes (useful in Typescript)

```js
export class User extends Model {
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public readonly deletedAt!: Date; // necesssary if using paranoid:true
  public id!: string;
  public username!: string;
  public email!: string;
}
export class UserHistory extends User {
  public readonly archivedAt!: Date;
  public readonly transactionId!: string; // necessary if logTransactionId: true
  public readonly eventId!: string;
}
// initialize the User model
User.init({
  id: {
    type: UUID,
    defaultValue: UUIDV4,
    primaryKey: true,
    unique: true,
  },
  username: {
    type: new DataTypes.STRING(),
    unique: true,
  },
  email: {
    type: new DataTypes.STRING(),
  },
},
{
  sequelize,
  tableName: 'User',
  paranoid: true,
});
// initialize the UserHistory model
Temporalize({
  model: User,
  modelHistory: UserHistory,
  sequelize,
  temporalizeOptions: {/* some options can be put here */},
});
```

The output of `Temporalize` is its history model. If you pass it a modelHistory
class, it will return that same modelHistory class.

## IMPORTANT NOTE

If you would like to keep track of deletes in the history table, you MUST use
the `paranoid: true` option when creating the original table.

## Options

The default syntax for `Temporalize` is:

`Temporalize({model, historymodel, sequelize, temporalizeOptions})`

whereas the temporalizeOptions are listed here (with default value).

### temporalizeOptions.blocking = true

Runs the insert within the sequelize hook promise chain, disable for increased
performance without warranties.

### temporalizeOptions.modelSuffix = 'History'

By default sequelize-temporalize will add 'History' to the history model name
and 'Histories' to the history table. By updating the modelSuffix value, you can
decide what the naming will be. The value will be appended to the history model
name and its plural will be appended to the history tablename.

examples for table User:
modelSuffix: '\_Hist' --> History Model Name: User_Hist --> History Table Name: User_Hists
modelSuffix: 'Memory' --> History Model Name: UserMemory --> History Table Name: UserMemories
modelSuffix: 'Pass' --> History Model Name: UserPass --> History Table Name: UserPasses

### temporalizeOptions.indexSuffix = '\_history'

All indexes that are preserved during the creation of the history table will
have a '\_history' suffix added to make it distinct to the original table's
index.

### temporalizeOptions.addAssociations = true

By default sequelize-temporalize will create the history table without
associations. However, setting this flag to true, you can keep association
between the history table and the table with the latest value (origin).

NOTE: THIS DOES NOT WORK IF YOU ARE USING A SEPARATE DB FOR THE HISTORICAL
TABLES. IN THAT CASE, KEEP THE VALUE TO FALSE OR YOU WILL GET AN ERROR.

example for table User:
model: 'User'
history model: 'UserHistories'
--> This would add function User.getUserHistories() to return all history entries for that user entry.
--> This would add function UserHistories.getUser() to get the original user from an history.

If a model has associations, those would be mirrored to the history table.
Origin model can only get its own histories.
Even if a history table is associated to another origin table thought a foreign
key field, the history table is not accessible from that origin table

Basically, what you can access in the origin table can be accessed from the
history table.

example:
model: User
history model: UserHistories

model: Creation
history model: CreationHistories

User <-> Creation: 1 to many

User.getCreations() exists (1 to many)
Creation.getUser() exists (1 to 1)

User <-> UserHistories: 1 to many

User.getUserHistories() exists (1 to many)
UserHistories.getUser() exists (1 to 1)

Creation <-> CreationHistories: 1 to many

Creation.getCreationHistories() exists (1 to many)
CreationHistories.getCreation() exists (1 to 1)

CreationHistories -> User: many to 1

CreationHistories.getUser() exists (1 to 1) (same as Creation.getUser())
User.GetCreationHistories DOES NOT EXIST. THE ORIGIN TABLE IS NOT MODIFIED.

UserHistories -> Creation: many to many

UserHistories.getCreations() exists (1 to many) (same as User.getCreations())
CreationHistories.getUser() DOES NOT EXIST. THE ORIGIN TABLE IS NOT MODIFIED.

### temporalizeOptions.allowTransactions = true

By default, transactions are allowed but can be disabled with that flag for the
historical tables (transactions on original tables should stay the same). It is
useful in case you are using a separate DB than the one use by the original DB.

NOTE: IF YOU USE A SEPARATE DB FOR HISTORICAL TABLE, SET THE VALUE TO FALSE OR
YOU WILL GET AN ERROR.

### temporalizeOptions.logTransactionId = true

Logging the transactionId allows you to identify records that have been updated
in a single transaction across tables.

### temporalizeOptions.logEventId = true

Logging event IDs allow you to keep track of operations that occur in a single
event, and if you simultaneously keep a history of requests in anther table, who
performed them.
For example, we may be updating multiple tables in a single request. We want a
way of identifying the single operation across multiple tables in the table
histories. To do this, we store the eventId. It is important that immediately
after the creation of the eventId that the eventId, current time, route being
requested and user ID of the individual making the request (and any other
information you think is important) is stored in a request table.

```js
import { uuidv4 } from 'uuid/v4';
import { addEventIdToTransaction } from 'sequelize-temporalize';
import { RequestLog } from '../models/request-log'; // the RequestLog table
import { Post } from '../models/post'; // the Posts table

await sequelize.transaction(async transaction => {
  const userId = req.userId;
  const eventId = uuidv4(); // for example, can use other uuid functions to generate unique ids for the request event
  // Log the request
  await RequestLog.create({
    userId,
    date: new Date(),
    eventId,
    transactionId: getTransactionId(transaction)
  });

  // Do other things with the same transaction
  Post.create({ title: req.body.title, text: req.body.text });
  // The transactionId and eventId will be logged in the associated history table for Post AND in RequestLog
});
```

### History table

History table stores historical versions of rows, which are inserted by triggers
on every modifying operation executed on current table. It has the same
structure and indexes as current table, but it doesn’t have any constraints.
History tables are insert only and creator should prevent other users from
executing updates or deletes by correct user rights settings. Otherwise the
history can be violated.

### Hooks

Triggers for storing old versions of rows to history table are inspired by
referential integrity triggers. They are fired for each row after UPDATE and
DELETE (within the same transaction)

### IMPORTANT

If you use `destroy` or `restore` methods it is very important that you use
`paranoid: true` on all models you plan to use destroy/restore on, to ensure
that copies of the data exist in the DB to be copied into the history table.

## License

The MIT License (MIT)

Copyright (c) 2015 James Jansson, Hosportal, BonaVal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
