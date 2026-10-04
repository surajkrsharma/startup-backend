import { D } from '../../utils/defaults';
import {
  serializeAttribute,
  serializeBrand,
  serializeCollection,
  serializeTag,
} from '../../utils/serialize';

export { serializeAttribute, serializeBrand, serializeCollection, serializeTag };

export const serializeBrandList = (rows: any[]) => ({
  brandList: D.arr(rows).map(serializeBrand),
});

export const serializeTagList = (rows: any[]) => ({
  tagList: D.arr(rows).map(serializeTag),
});

export const serializeAttributeList = (rows: any[]) => ({
  attributeList: D.arr(rows).map(serializeAttribute),
});

export const serializeCollectionList = (rows: any[]) => ({
  collectionList: D.arr(rows).map(serializeCollection),
});

export const serializeBulkResult = (r: any) => ({
  successCount: D.num(r?.successCount),
  failCount: D.num(r?.failCount),
  totalCount: D.num(r?.successCount) + D.num(r?.failCount),

  errorList: D.arr(r?.errors).map((e: any) => ({
    row: D.num(e?.row),
    message: D.str(e?.message),
  })),
});
