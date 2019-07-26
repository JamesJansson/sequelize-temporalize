var _ = require('lodash');

var temporalDefaultOptions = {
  // runs the insert within the sequelize hook chain, disable
  // for increased performance
  blocking: true,
  full: false,
  modelSuffix: 'History',
  indexSuffix: '_history',
  deletedColumnName: 'temporalizeDeleted',
  addAssociations: false,
  allowTransactions: true
};

var Temporal = function(model, sequelize, temporalOptions) {
  temporalOptions = _.extend({}, temporalDefaultOptions, temporalOptions);

  var Sequelize = sequelize.Sequelize;

  var historyName = model.name + temporalOptions.modelSuffix;

  var historyOwnAttrs = {
    hid: {
      type: Sequelize.BIGINT,
      primaryKey: true,
      autoIncrement: true,
      unique: true
    },
    archivedAt: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.NOW
    },
    [temporalOptions.deletedColumnName]: {
      type: Sequelize.DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: null
    }
  };

  var excludedAttributes = [
    'Model',
    'unique',
    'primaryKey',
    'autoIncrement',
    'set',
    'get',
    '_modelAttribute',
    'references',
    'onDelete',
    'onUpdate'
  ];
  var historyAttributes = _(model.rawAttributes)
    .mapValues(function(v) {
      v = _.omit(v, excludedAttributes);
      // remove the "NOW" defaultValue for the default timestamps
      // we want to save them, but just a copy from our master record
      if (v.fieldName == 'createdAt' || v.fieldName == 'updatedAt') {
        v.type = Sequelize.DATE;
      }
      return v;
    })
    .assign(historyOwnAttrs)
    .value();
  // If the order matters, use this:
  //historyAttributes = _.assign({}, historyOwnAttrs, historyAttributes);

  var historyOwnOptions = {
    timestamps: false
  };
  var excludedNames = [
    'name',
    'tableName',
    'sequelize',
    'uniqueKeys',
    'hasPrimaryKey',
    'hooks',
    'scopes',
    'instanceMethods',
    'defaultScope'
  ];
  var modelOptions = _.omit(model.options, excludedNames);
  var historyOptions = _.assign({}, modelOptions, historyOwnOptions);

  // We want to delete indexes that have unique constraint
  var indexes = _.cloneDeep(historyOptions.indexes);
  if (Array.isArray(indexes)) {
    historyOptions.indexes = indexes.filter(function(index) {
      return !index.unique && index.type != 'UNIQUE';
    });
  }
  historyOptions.indexes.forEach(indexElement => {
    indexElement.name += temporalOptions.indexSuffix;
  });

  var modelHistory = sequelize.define(
    historyName,
    historyAttributes,
    historyOptions
  );
  modelHistory.originModel = model;
  modelHistory.addAssociations = temporalOptions.addAssociations;

  // we already get the updatedAt timestamp from our models
  var insertHook = function(obj, options) {
    var dataValues = _.cloneDeep(
      (!temporalOptions.full && obj._previousDataValues) || obj.dataValues
    );
    if (options.deleteOperation) {
      dataValues[temporalOptions.deletedColumnName] = true;
    }
    var historyRecord = modelHistory.create(dataValues, {
      transaction: temporalOptions.allowTransactions
        ? options.transaction
        : null
    });
    if (temporalOptions.blocking) {
      return historyRecord;
    }
  };

  var insertBulkHook = function(options) {
    if (!options.individualHooks) {
      var queryAll = model
        .findAll({
          where: options.where,
          transaction: options.transaction,
          paranoid: false
        })
        .then(function(hits) {
          if (hits) {
            hits = _.map(hits, 'dataValues');
            hits.forEach(ele => {
              ele.archivedAt = ele.updatedAt;
            });
            if (options.deleteOperation) {
              hits.forEach(ele => {
                ele[temporalOptions.deletedColumnName] = true;
                // If paranoid is true, use the deleted value
                ele.archivedAt = ele.deletedAt || Date.now();
              });
            }
            return modelHistory.bulkCreate(hits, {
              transaction: temporalOptions.allowTransactions
                ? options.transaction
                : null
            });
          }
        });
      if (temporalOptions.blocking) {
        return queryAll;
      }
    }
  };

  var beforeSync = function(options) {
    const source = this.originModel;
    const sourceHist = this;

    if (
      source &&
      !source.name.endsWith(temporalOptions.modelSuffix) &&
      source.associations &&
      temporalOptions.addAssociations == true &&
      sourceHist
    ) {
      const pkfield = source.primaryKeyField;
      //adding associations from history model to origin model's association
      Object.keys(source.associations).forEach(assokey => {
        const association = source.associations[assokey];
        const associationOptions = _.cloneDeep(association.options);
        const target = association.target;
        const assocName =
          association.associationType.charAt(0).toLowerCase() +
          association.associationType.substr(1);
        associationOptions.onDelete = 'NO ACTION';
        associationOptions.onUpdate = 'NO ACTION';

        //handle primary keys for belongsToMany
        if (assocName == 'belongsToMany') {
          sourceHist.primaryKeys = _.forEach(
            source.primaryKeys,
            x => (x.autoIncrement = false)
          );
          sourceHist.primaryKeyField = Object.keys(sourceHist.primaryKeys)[0];
        }

        sourceHist[assocName].apply(sourceHist, [target, associationOptions]);
      });

      //adding associations between origin model and history
      source.hasMany(sourceHist, { foreignKey: pkfield });
      sourceHist.belongsTo(source, { foreignKey: pkfield });

      sequelize.models[sourceHist.name] = sourceHist;
    }

    return Promise.resolve('Temporal associations established');
  };

  const deleteHook = (obj, options) => {
    options.deleteOperation = true;
    insertHook(obj, options);
  };

  const afterDeleteBulkHook = options => {
    options.deleteOperation = true;
    insertBulkHook(options);
  };
  const beforeDeleteBulkHook = options => {
    options.deleteOperation = true;
    insertBulkHook(options);
  };

  // use `after` to be nonBlocking
  // all hooks just create a copy
  if (temporalOptions.full) {
    model.addHook('afterCreate', insertHook);
    model.addHook('afterUpdate', insertHook);
    model.addHook('afterBulkUpdate', insertBulkHook);
    model.addHook('afterDestroy', deleteHook);
    model.addHook('afterBulkDestroy', afterDeleteBulkHook);
    model.addHook('afterRestore', insertHook);
  } else {
    model.addHook('beforeUpdate', insertHook);
    model.addHook('beforeDestroy', deleteHook);
  }

  model.addHook('beforeBulkUpdate', insertBulkHook);
  model.addHook('beforeBulkDestroy', beforeDeleteBulkHook);

  var readOnlyHook = function() {
    throw new Error(
      "This is a read-only history database. You aren't allowed to modify it."
    );
  };

  modelHistory.addHook('beforeUpdate', readOnlyHook);
  modelHistory.addHook('beforeDestroy', readOnlyHook);
  modelHistory.addHook('beforeSync', 'HistoricalSyncHook', beforeSync);

  return model;
};

module.exports = Temporal;
