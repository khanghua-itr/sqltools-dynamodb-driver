import * as dynamodb from '@aws-sdk/client-dynamodb';
import {  DynamoDBClient,  DynamoDBClientConfig  } from '@aws-sdk/client-dynamodb';
const attr = require('dynamodb-data-types').AttributeValue;

export type DynamoDBConfig = DynamoDBClientConfig;

const dynamoDBScalarTypesMapper = {
  'N': 'number',
  'S': 'string',
  'B': 'buffer',
  'BOOL': 'boolean',
  'SS': 'stringset',
  'NS': 'numberset',
  'BS': 'binaryset',
  'M': 'map',
  'L': 'list',
};

enum Ordered {
  LOW = 0,
  MEDIUM,
  HIGH,
}

export interface Column {
  columnName: string
  columnType: string
  keyType?: string
  sortOrdered: Ordered
}

export interface Index {
  indexName: string
  keys: Column[]
}

export interface Table {
  tableName: string
  indexes: Index[]
  columns: Column[]
  rawData: any
}

export class DynamoDBLib {
  private client: DynamoDBClient;

  constructor(config: DynamoDBConfig) {
    this.client = new DynamoDBClient(config);
  }

  public async listTables(): Promise<string[]> {
    let exclusiveStart: string;
    const tablesNames: string[] = [];
    while (true) {
      const command = new dynamodb.ListTablesCommand({
        ExclusiveStartTableName: exclusiveStart,
      });
      const result = await this.client.send(command);
      tablesNames.push(...result.TableNames);  
      exclusiveStart = result.LastEvaluatedTableName;
      if (!exclusiveStart) {
        break;
      }
    }
    return tablesNames;
  }

  private async getColumns(tableName: string): Promise<Column[]> {
    const command = new dynamodb.ScanCommand({
      TableName: tableName,
      Limit: 1,
    });
    const result = await this.client.send(command);
    const item = result.Items[0] || {};

    const cols = Object.keys(item).map(key => {
      const val = item[key];
      const dataType = Object.keys(dynamoDBScalarTypesMapper).find(type => !!val[type]) || '';
      return <Column>{
        columnName: key,
        columnType: dynamoDBScalarTypesMapper[dataType] || 'unknown',
        sortOrdered: Ordered.LOW,
      };
    });
    return cols;
  }

  public async describeTable(tableName: string): Promise<Table> {
    const command = new dynamodb.DescribeTableCommand({ 
      TableName: tableName, 
    });
    const result = await this.client.send(command);
    const cols = await this.getColumns(tableName);
    const indexes = result.Table?.GlobalSecondaryIndexes?.map(gsi => <Index>{
      indexName: gsi.IndexName,
      keys: gsi.KeySchema.map(key => <Column>{
        columnName: key.AttributeName,
        keyType: key.KeyType,
      }),
    }) || [];
    
    for (const key of result.Table.KeySchema) {
      const col = cols.find(x => x.columnName === key.AttributeName);
      if (col) {
        col.keyType = key.KeyType;
        col.sortOrdered = col.keyType === 'HASH' 
          ? Ordered.HIGH  
          : Ordered.MEDIUM;
      }
    }
    cols.sort((left, right) => right.sortOrdered - left.sortOrdered);

    return <Table>{
      tableName: tableName,
      columns: cols,
      indexes,
      rawData: result,
    };
  }

  public async query(query: string, opt: { limit?: number } = {})  {
    let limit = 50;
    if (opt.limit) {
      limit = opt.limit;
    }

    const command = new dynamodb.ExecuteStatementCommand({
      Statement: query,
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
      Limit: limit,
    });
    const result = await this.client.send(command);
    let cols = {};
    const items = [];
    for (const rawItem of result.Items) {
      cols = {
        ...cols,
        ...Object.keys(rawItem).reduce((prev, x) => ({ ...prev, [x]: 1 }), {}),
      };
      items.push(attr.unwrap(rawItem));
    }
    return {
      cols: Object.keys(cols),
      items,
    };
  }
}


